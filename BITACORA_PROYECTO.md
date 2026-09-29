# 🧭 BITÁCORA TÉCNICA Y GUÍA RÁPIDA DE ARQUITECTURA
**Proyecto:** Visualización Cartográfica e Isovistas Urbanas • Corredor Norte-Sur de Morelia  
**Repositorio GitHub:** [https://github.com/edgardamian/recorridos](https://github.com/edgardamian/recorridos) (Rama: `main`)  
**Fecha de consolidación:** Septiembre 2026  

---

## ⚡ Resumen Ejecutivo para Agentes y Desarrolladores
Este documento permite a cualquier agente o desarrollador comprender el 100% de la arquitectura, decisiones de diseño, estructura de archivos y comandos en menos de 30 segundos, sin necesidad de hacer lecturas exploratorias redundantes.

- **Objetivo:** Visualización y análisis del campo visual peatonal (isovistas) a lo largo de una ruta de 4.66 km en Morelia, integrando relieve topográfico 3D (DEM), extrusión de 24,714 edificios según sus alturas reales y un motor de animación de recorrido en tiempo real.
- **Entorno de ejecución:** **100% estático**. Abre directamente con doble clic en `mapa/index.html` (o vía GitHub Pages). **No requiere servidor local ni terminal para funcionar.**
- **Stack tecnológico:** MapLibre GL JS v5, Vanilla JavaScript ES6+, HTML5 semántico, CSS Glassmorphism Dark Theme, Python (GeoPandas, Shapely, PyProj, Rtree) en Conda `Python (isovistas)`.

---

## 📁 Estructura del Repositorio (`mapa/`)

```text
mapa/ (Raíz del repositorio Git 'recorridos')
├── index.html                  # Shell de la aplicación: panel lateral, mapa base, botón pill minimizado y HUD de animación
├── styles.css                  # Sistema de diseño Glassmorphism oscuro, variables CSS, microanimaciones y estilos responsivos
├── app.js                      # Controlador maestro (~1700 líneas): capas 2D/3D, popups, interactividad y bucle de animación
├── README.md                   # Documentación pública para usuarios y GitHub Pages
├── .gitignore                  # Exclusiones de Git (temporales, caches, IDEs)
├── scripts/
│   └── generar_datos_animacion.py  # Script generador en Python para recalcular los fotogramas de animación
└── datos/                      # Conjunto de datos espaciales duales (.geojson y .js para ejecución sin servidor)
    ├── metadata.js / .json         # Métricas generales (longitud 4,660.7 m, 26 hitos, centro inicial)
    ├── ruta.js / .geojson          # Geometría LineString de la trayectoria peatonal
    ├── referencias.js / .geojson   # 26 hitos y puntos de referencia urbanos con coordenadas y nombres
    ├── envolvente.js / .geojson    # Polígono disuelto de la cuenca visual acumulada total (25.32 ha)
    ├── edificios.js / .geojson     # 24,714 huellas de edificaciones con atributos 'altura' y 'niveles' (8.46 MB)
    └── animacion.js / .json        # 235 fotogramas secuenciales (cada 20 m): isovista, rumbo suavizado y telemetría (610 KB)
```

---

## 🔑 Mecanismos y Decisiones Arquitectónicas Críticas

### 1. Compatibilidad 100% Estática sin Servidor (CORS Bypass)
- Si el usuario abre el mapa con protocolo `file:///`, los navegadores bloquean llamadas `fetch()` a archivos locales.
- **Solución:** Cada archivo en `datos/` existe en formato `.geojson` y en `.js` (`window.DATOS_* = {...}`).
- En `app.js`, la función `fetchGeoJSON()` intenta primero un `fetch()` asíncrono y, si falla por CORS o protocolo local, recurre instantáneamente a la variable global precargada en memoria sin interrupciones.

### 2. Motor de Animación e Isovistas Progresivas
- **Precalculado vs Tiempo Real:** Calcular isovistas vectoriales contra 24,714 polígonos en el navegador en tiempo real causaría caídas a < 5 FPS. Por ello, `generar_datos_animacion.py` precalculó los 235 fotogramas (uno cada 20 m) con Shapely y Rtree en 27 segundos.
- **60 FPS constantes:** En `app.js`, los 235 fotogramas se transforman en memoria a un array de objetos GeoJSON (`appState.prebuiltFeatures`). Al avanzar, `map.getSource("anim_acum_src").setData(...)` hace un slice en memoria en `< 0.2 ms` con cero recolección de basura (*GC*).
- **Ciclo de Vida Minimizado / Desplegado:**
  - **Al inicio:** Las herramientas arrancan minimizadas en un botón flotante inferior (`.anim-pill-launcher`). El mapa luce limpio como un mapa interactivo normal 2D y el marcador/cono no se muestran.
  - **Al desplegar:** Aparece la barra HUD flotante, se posiciona el marcador del observador en el inicio y se proyecta el **polígono inicial de isovistas** del punto de partida. La envolvente estática se oculta automáticamente.
  - **Al minimizar:** Se pausa la animación, se limpia el cono del mapa, se oculta el marcador y se restaura la envolvente estática original.

### 3. Cámara Seguidora 3D Detrás del Punto (*Chase Camera*)
- **Perspectiva en Tercera Persona:** En modo 3D, la cámara se orienta con:
  - `pitch: 58°` (inclinación oblicua para apreciar el cañón urbano y el cielo).
  - `zoom: 16.2` (escala peatonal detallada).
  - `bearing: frame.cam_bearing` (rumbo de avance de la ruta).
  - `offset: [0, 50]` (desplaza ligeramente el punto hacia abajo en la pantalla para dejar el 65% superior abierto al frente).
- **Suavizado de Giro (*Angular Smoothing*):** Para evitar movimientos bruscos al doblar esquinas de 90° en el Centro Histórico, cada fotograma incluye `cam_bearing`, calculado mediante un filtro de media móvil circular ponderada de 5 cuadros.
- **Flecha Direccional Relativa:** La flecha del marcador rota calculando `(frame.bearing - map.getBearing() + 360) % 360`, asegurando que cuando la cámara va detrás, la flecha apunte siempre hacia adelante en pantalla.
- **Botón Rápido de Conmutación:** Permite alternar en el reproductor entre `🌐 Cámara 3D (Detrás)` y `📐 Vista 2D (Cenital)`.

### 4. Capas 3D y Exageraciones (Relieve y Edificios)
- **Terreno DEM 3D:** *AWS Terrarium DEM* (`raster-dem`) con botones de escala `Real (1x)`, `2x` y `3x`.
- **Edificios 3D:** Capa `fill-extrusion` vinculada al campo `'altura'` de cada polígono, con rampa cromática según altitud y botones de exageración `1x`, `2x` y `3x`.
- **Exclusividad de Popups:** Al hacer clic en un hito o seleccionarlo del buscador, cualquier popup anterior se destruye (`activePopup.remove()`) para evitar saturación visual.

---

## 🛠️ Comandos de Mantenimiento y Flujo de Trabajo

### Entorno Python
```powershell
# Usar siempre el entorno Conda designado
& "C:\Users\DI-IMPLAN\.conda\envs\isovistas\python.exe" <script.py>
```

### Validar Sintaxis JavaScript
```powershell
node -c mapa/app.js; node -c mapa/datos/animacion.js
```

### Recalcular Fotogramas de Animación (si se modifica la ruta o los edificios)
```powershell
& "C:\Users\DI-IMPLAN\.conda\envs\isovistas\python.exe" generar_datos_animacion.py
```

### Servidor Local Opcional (si se desea probar vía HTTP)
```powershell
python -m http.server 8000 --directory mapa
# Abrir: http://localhost:8000
```

### Sincronización y Despliegue en GitHub
```powershell
cd d:\bitacora_investigacion\2026\4T_TRIMESTRE\4T_ISOVISTAS\mapa
git status
git add .
git commit -m "feat/fix: descripción del cambio"
git push origin main
```
*GitHub Pages sirve automáticamente la rama `main` desde la raíz.*
