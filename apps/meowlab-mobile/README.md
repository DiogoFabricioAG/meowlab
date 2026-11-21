# MeowLab Mobile (Android · Capacitor)

Empaquetado nativo del portal (`apps/meowlab-app`) con Capacitor (`tech.meowlab.app`), según [ADR-0018](../../docs/decisions/0018-app-movil-android-capacitor.md).

## Requisitos

- **Node.js** 22+
- **Android Studio** con Android SDK Platform y Build-Tools instalados
- **JDK 21** (incluido en el JBR de Android Studio: `C:\Program Files\Android\Android Studio\jbr`)
- Variable `ANDROID_HOME` apuntando al SDK de Android (por ejemplo `%LOCALAPPDATA%\Android\Sdk`)

## Comandos

```bash
cd apps/meowlab-mobile
npm install
npm run build:web   # compila ../meowlab-app con VITE_API_ORIGIN (por defecto https://app.meowlab.tech)
npm run sync        # npx cap sync android
npm run apk:debug   # ./gradlew assembleDebug -> android/app/build/outputs/apk/debug/app-debug.apk
```

Para probar contra un portal local desde el emulador de Android Studio:

```bash
VITE_API_ORIGIN=http://10.0.2.2:8787 npm run build:web
npm run sync
npm run apk:debug
```
