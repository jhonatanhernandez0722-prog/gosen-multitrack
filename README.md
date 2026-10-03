# Gosen Multitrack

Reproductor multipista local para servicios de iglesia, con integración con Holyrics.

## Desarrollo

```bash
npm install
npm run dev         # abre la app con recarga en caliente
npm run typecheck   # comprobación de tipos (main + renderer)
npm run build       # build de producción en out/
npm run fixtures    # genera archivos de prueba (requiere Python)
npm run selftest    # prueba de integración: servicios + UI + Holyrics simulado
npm run dist:win    # instalador de Windows en dist/
```

## macOS

Apple solo permite compilar apps de Mac en un Mac. Dos formas:

- **En un Mac:** `npm install` y después `npm run dist:mac`. Genera un único `.dmg` universal (Apple Silicon e Intel) en `dist/`.
- **Sin Mac (GitHub Actions):** sube el proyecto a un repositorio de GitHub y ejecuta el flujo *Build* (pestaña Actions → Build → Run workflow).
  Compila y ejecuta la autoprueba en macOS y Windows, y deja los instaladores en *Artifacts*.

La app de Mac va con firma ad-hoc (no hay certificado de Apple). La primera vez, macOS la bloqueará:
abre *Ajustes del Sistema › Privacidad y seguridad* y pulsa **"Abrir igualmente"**. Si dice que la app "está dañada"
(pasa al descargarla de internet), ejecuta en Terminal: `xattr -cr "/Applications/Gosen Multitrack.app"`.
Para distribuirla sin avisos hace falta el Apple Developer Program (99 USD/año) para firmarla y notarizarla.

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): stack, procesos, motor de audio, almacenamiento y fases.
- [docs/HOLYRICS.md](docs/HOLYRICS.md): qué permite realmente la API Server oficial de Holyrics.
