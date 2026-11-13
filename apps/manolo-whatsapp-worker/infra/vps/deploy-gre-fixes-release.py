"""Operate only the reviewed Manolo release. No fiscal issuance or database migration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path('/opt/manolo-platform/releases/gre-fixes-20261106')
COMPOSE = Path('/opt/manolo-platform/infra/vps')
BASE_IMAGE = 'sha256:84ee1c657f154b4e2f4aeda4c7797eff7db9d7036162c6964c6a429995d562f8'
BASE_HASH = '1ad5152200d77b846fc3a7f8810c725ad7c51f0230a3c146f3ed877dca9f07af'
OLD_TAG = 'manolo-platform-bridge:before-gre-fixes-20261106'
NEW_TAG = 'manolo-platform-bridge:gre-fixes-20261106'
STAGE = 'manolo-fiscal-stage-20261105'
RESTORE = 'manolo-fiscal-restore-20261105'
LABEL = 'meowlab.release=gre-fixes-20261106'


def report(**values):
    print(json.dumps(values), flush=True)


def run(args, data=None, stdout=None):
    result = subprocess.run(args, input=data, stdout=stdout or subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        with (ROOT / 'ops-error.log').open('ab') as log:
            log.write(result.stderr)
        raise RuntimeError('Operational command failed: ' + args[0] + ' (private diagnostic saved)')
    return result.stdout


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def remove_owned(name):
    check = subprocess.run(['docker', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if check.returncode:
        return
    info = json.loads(check.stdout)[0]
    if info['Config']['Labels'].get('meowlab.release') != 'gre-fixes-20261106':
        raise RuntimeError('Refusing to remove an unrelated container')
    run(['docker', 'rm', '-f', '-v', name])


def ready(name, command):
    for _ in range(60):
        result = subprocess.run(['docker', 'exec', name] + command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            return
        time.sleep(0.5)
    raise RuntimeError('Readiness failed: ' + name)


def fingerprint(info):
    return {
        'environmentHash': hashlib.sha256(json.dumps(sorted(info['Config']['Env'])).encode()).hexdigest(),
        'networks': sorted(info['NetworkSettings']['Networks']),
        'mounts': sorted((m['Type'], m['Source'], m['Destination'], m['RW']) for m in info['Mounts']),
        'readOnly': info['HostConfig']['ReadonlyRootfs'],
        'memory': info['HostConfig']['Memory'],
        'caps': info['HostConfig']['CapDrop'],
    }


def stage():
    original = inspect('manolo-platform-bridge-1')
    if original['Image'] != BASE_IMAGE:
        raise RuntimeError('Bridge image drift')
    original_bundle = run(['docker', 'exec', 'manolo-platform-bridge-1', 'cat', 'dist/node/server.mjs'])
    if hashlib.sha256(original_bundle).hexdigest() != BASE_HASH:
        raise RuntimeError('Bridge source drift')
    if shutil.disk_usage(ROOT).free < 1024 ** 3:
        raise RuntimeError('Insufficient room for independent backups')
    (ROOT / 'bridge.before.mjs').write_bytes(original_bundle)
    (ROOT / 'runtime-fingerprint.json').write_text(json.dumps(fingerprint(original)))
    shutil.copy2(COMPOSE / 'compose.yml', ROOT / 'compose.before.yml')
    run(['docker', 'image', 'tag', BASE_IMAGE, OLD_TAG])
    image_backup = ROOT / 'bridge-image.before.tar'
    if not image_backup.exists():
        run(['docker', 'image', 'save', '--output', str(image_backup), OLD_TAG])
    report(stage='image_backup_ok')
    dump = ROOT / 'platform.before.dump'
    if not dump.exists():
        with dump.open('xb') as output:
            run(['docker', 'exec', 'manolo-platform-postgres-1', 'sh', '-c',
                 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], stdout=output)
    if dump.stat().st_size < 100:
        raise RuntimeError('Database backup incomplete')
    report(stage='postgres_backup_ok', bytes=dump.stat().st_size)
    postgres_image = inspect('manolo-platform-postgres-1')['Config']['Image']
    run(['docker', 'run', '-d', '--name', RESTORE, '--label', LABEL, '--network', 'none',
         '--memory', '512m', '--cpus', '0.5', '--tmpfs', '/var/lib/postgresql/data:rw,size=768m',
         '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', postgres_image])
    try:
        ready(RESTORE, ['pg_isready', '-U', 'postgres'])
        run(['docker', 'exec', '-i', RESTORE, 'pg_restore', '-U', 'postgres', '-d', 'postgres',
             '--no-owner', '--no-privileges', '--exit-on-error'], data=dump.read_bytes())
        tables = run(['docker', 'exec', RESTORE, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
                      "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('whatsapp','print_system')"]).decode().strip()
        if int(tables) < 10:
            raise RuntimeError('Restored schemas incomplete')
        report(stage='postgres_restore_ok', tables=int(tables))
    finally:
        remove_owned(RESTORE)
    with (ROOT / 'build.log').open('wb') as output:
        run(['docker', 'build', '-t', NEW_TAG, str(ROOT / 'bridge')], stdout=output)
    new_image = inspect(NEW_TAG)['Id']
    (ROOT / 'new-image.id').write_text(new_image)
    env_file = ROOT / 'staging.env'
    env_file.write_text('\n'.join(original['Config']['Env']) + '\n')
    env_file.chmod(0o600)
    command = ['docker', 'run', '-d', '--name', STAGE, '--label', LABEL, '--network', 'manolo_internal',
               '--env-file', str(env_file), '--read-only', '--tmpfs', '/tmp:rw,size=32m',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '384m']
    for mount in original['Mounts']:
        if not mount['Destination'].startswith('/run/secrets/') or mount['RW']:
            raise RuntimeError('Unexpected secret mount contract')
        command += ['--mount', 'type=bind,src=' + mount['Source'] + ',dst=' + mount['Destination'] + ',readonly']
    run(command + [NEW_TAG])
    env_file.unlink()
    ready(STAGE, ['node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"])
    report(stage='staging_ready', image=new_image, public_ingress=False)


def activate():
    current = inspect('manolo-platform-bridge-1')
    expected = json.loads((ROOT / 'runtime-fingerprint.json').read_text())
    if current['Image'] != BASE_IMAGE or json.loads(json.dumps(fingerprint(current))) != expected:
        raise RuntimeError('Live bridge or configuration drift')
    new_image = (ROOT / 'new-image.id').read_text()
    run(['docker', 'image', 'tag', new_image, 'manolo-platform-bridge:latest'])
    try:
        run(['docker', 'compose', '--project-directory', str(COMPOSE), '--env-file', str(COMPOSE / '.env'),
             '-f', str(COMPOSE / 'compose.yml'), 'up', '-d', '--no-deps', '--no-build', 'bridge'])
        ready('manolo-platform-bridge-1', ['node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"])
        after = inspect('manolo-platform-bridge-1')
        if after['Image'] != new_image or json.loads(json.dumps(fingerprint(after))) != expected:
            raise RuntimeError('Activation configuration mismatch')
        report(activation='ok', image=new_image, configuration_preserved=True)
    except Exception:
        rollback()
        raise


def rollback():
    run(['docker', 'image', 'tag', OLD_TAG, 'manolo-platform-bridge:latest'])
    run(['docker', 'compose', '--project-directory', str(COMPOSE), '--env-file', str(COMPOSE / '.env'),
         '-f', str(COMPOSE / 'compose.yml'), 'up', '-d', '--no-deps', '--no-build', 'bridge'])
    ready('manolo-platform-bridge-1', ['node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"])
    report(rollback='ok', image=inspect('manolo-platform-bridge-1')['Image'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['stage', 'activate', 'rollback', 'cleanup'])
    args = parser.parse_args()
    if ROOT.resolve() != ROOT or COMPOSE.resolve() != COMPOSE:
        raise RuntimeError('Unexpected operational paths')
    os.umask(0o077)
    if args.phase == 'stage':
        stage()
    elif args.phase == 'activate':
        activate()
    elif args.phase == 'rollback':
        rollback()
    else:
        remove_owned(STAGE)
        report(cleanup='staging_removed')
