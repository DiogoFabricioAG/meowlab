// Let OpenSSH resolve HostName, User, IdentityFile, agent and port from its
// configuration; do not bind the TUI to a retired VPS or a particular key.
export function createSshConnectionConfig(environment = process.env) {
  return {
    host: environment.MANOLO_VPS_HOST?.trim() || "meowlab",
    keyPath: environment.MANOLO_VPS_SSH_KEY?.trim() || null,
  };
}

export function sshConnectionArgs({ host, keyPath }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9@._:-]*$/.test(host)) {
    throw new Error("MANOLO_VPS_HOST contiene caracteres no permitidos.");
  }
  return [
    ...(keyPath ? ["-i", keyPath] : []),
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
    host,
  ];
}
