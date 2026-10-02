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

## 📌 Registro de Ajustes Clave (Soluciones de Arquitectura)

### Corrección de Mapa Satelital y Estabilidad de Zoom en Perspectiva 3D
- **Aislamiento de Mapas Base**: Al alternar a `satelital`, se ocultan explícitamente las capas vectoriales del mapa base `Carto Dark Matter` (`source: 'carto'` y `id: 'background'`), restaurándolas al volver a `oscuro`. Esto evita que el fondo oscuro quede por debajo o se filtre visualmente.
- **Sincronización DEM de Elevación**: Se ajustó `maxzoom: 14` en la fuente DEM `terrain-dem-src` para alinearse con el `maxzoom: 14` de las teselas Carto. Esto elimina por completo el error WebGL interno `cannot calculate elevation if elevation maxzoom > source.maxzoom` que corrompía la matriz de elevación en zooms $\ge 15$.
- **Límites de Frustum y Cámara 3D**: Se ajustó `maxPitch: 70` (en lugar de 85°) y `maxZoom: 21` para prevenir la penetración del plano de recorte cercano (`nearZ`) contra la superficie del terreno y evitar la desaparición intermitente de la malla y edificios durante el zoom en perspectiva.

### Herramientas de Medición Interactiva (Distancia y Área)
- **Modos de Medición**:
  - `Distancia`: Trazado de trayectorias multipunto con cálculo geodésico Haversine ($m$ y $km$), visualización de tramos, vértices numerados y guía elástica (*rubberband*) interactiva con previsualización en vivo.
  - `Área`: Delimitación de polígonos superficiales con cálculo de exceso esférico ($m^2$, hectáreas y $km^2$) y perímetro continuo.
- **Componentes de Interfaz**:
  - HUD superior flotante (`#measure-hud`) con métricas en tiempo real, instrucciones dinámicas de uso, botón de deshacer último punto (`Ctrl+Z` / `Backspace`), finalizar (`Doble Clic` / `Enter`) y cerrar (`Esc`).
  - Tarjeta de telemetría en el panel lateral derecho (`#panel-measure-card`) sincronizada con el estado.
  - Insignia flotante con el resultado final fijada sobre el último vértice (distancia) o el centroide geométrico (área).
- **Aislamiento de Eventos**: Supresión automática de popups de edificios e hitos urbanos mientras la herramienta está activa, con desactivación temporal del `doubleClickZoom` de MapLibre para finalizar cómodamente con doble clic.

### Etiquetas Nativas en WebGL para Hitos (Eliminación de Retraso/Lag)
- **Causa del retraso**: Las etiquetas de los hitos se instanciaban como 26 elementos DOM HTML (`maplibregl.Marker`). Al mover el mapa o reproducir la animación a 60 fps, el navegador debía calcular y sincronizar en el hilo principal la propiedad CSS `transform: translate3d(...)` para cada elemento DOM, provocando un retraso visible (1-2 fotogramas) respecto al lienzo WebGL acelerado por hardware.
- **Solución implementada**:
  - Se sustituyeron los marcadores DOM por capas nativas MapLibre de tipo `symbol`: `referencias-labels` (para la visualización general) y `referencias-active-label` (para el hito seleccionado).
  - Al renderizarse directamente en la GPU vía WebGL dentro de la misma llamada de dibujo que el mapa base y el terreno 3D, el desfase es **cero absoluto (0 ms)** tanto en paneo libre como en giros e inclinaciones 3D o reproducción de animación.
  - Se configuró `text-pitch-alignment: "viewport"` para que las etiquetas se mantengan orientadas verticalmente hacia la cámara incluso en perspectiva 3D (pitch 58°).
  - Clic interactivo y cursor `pointer` vinculados directamente a la capa de símbolos nativa.

### Respaldo en GitHub y Nuevas Mejoras Avanzadas
- **Estrategia de Respaldo y Ramas en Git**:
  - `main` (commit `5fd6ccb`) respaldado en `origin/main` y etiquetado con el tag inmutable `v1.0-estable` con las herramientas de medición y etiquetas nativas WebGL.
  - Las nuevas mejoras se desarrollaron en la rama `feature/mejoras-avanzadas` (commit `d0794a2`), permitiendo probar todo libremente sin alterar el estado estable.
- **Mejoras Incorporadas**:
  1. **Gráficas Duales Sincronizadas: Isovistas y Perfil Altitudinal (`#profile-chart-drawer`)**:
     - **Gráfica 1 (Área Visual de Isovistas)**: Curva SVG interactiva en cian brillante (`#38bdf8`) que cuantifica la cuenca visible en cada punto del recorrido (máx: 26,613 $m^2$, prom: 18,172 $m^2$, mín: 1,238 $m^2$) con hitos urbanos destacados.
     - **Gráfica 2 (Perfil Altitudinal Topográfico DEM)**: Curva SVG en esmeralda vivo (`#10b981`) con elevaciones reales extraídas del modelo digital de elevación (AWS Terrarium DEM) para los 235 puntos del corredor (cota máx: 1,929.5 msnm en el Centro Histórico, cota mín: 1,892.0 msnm en el Río Grande/Pípila, desnivel: +37.5 m). Hitos urbanos destacados en **amarillo dorado** (`#fbbf24`), alineados cromáticamente con la gráfica de isovistas.
     - **Selector de Vistas**: Pestañas `#tab-prof-both` (Ambas), `#tab-prof-iso` (sólo Isovistas) y `#tab-prof-elev` (sólo Altitud).
     - **Popup Bajo Demanda (Solo Clic) y Agujas Sincronizadas**: El popup/tooltip no interfiere con el movimiento libre del cursor; aparece **únicamente al hacer clic o arrastrar** sobre cualquiera de las gráficas, permaneciendo visible para su lectura con botón de cierre (`✕`) o al hacer clic fuera. Sincroniza la posición del observador a 60 fps e incluye telemetría completa (distancia, hito, área visual y cota msnm).
     - **Telemetría en Vivo**: Incorporación del chip `⛰️ Cota` en la barra HUD de animación.
  2. **Corrección Definitiva de Captura de Pantalla HD en PNG (`exportMapScreenshot`)**:
     - **Causa de la captura en blanco/transparente**: En MapLibre GL JS v5, `preserveDrawingBuffer` debe declararse dentro de `canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true }`. Al omitirlo en la configuración del contexto WebGL, el búfer de dibujo se limpiaba tras cada frame; al invocar `drawImage()` sobre el canvas inactivo, los píxeles eran 100% transparentes (alpha = 0), visualizándose como fondo blanco en el visor de fotos de Windows.
     - **Solución implementada**:
       1. Configuración de `canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true }` en `initMap()`.
       2. Ejecución de `map.triggerRepaint()` y espera síncrona de `map.once("render", ...)` antes de leer el lienzo.
       3. Relleno previo del lienzo de salida con fondo sólido `#090d16` (cero transparencia) antes de dibujar el mapa y el membrete institucional IMPLAN.
  3. **Conmutación Robusta de Seguimiento de Cámara (2D Cenital vs 3D Detrás)**:
     - **Causa del bloqueo en 3D**: Al conmutar de 2D a 3D, se activaba la extrusión de edificios (`buildings3DActive = true`). En `renderAnimationFrame`, la condición para cámara 3D evaluaba `appState.buildings3DActive || curPitch > 15`, lo que impedía volver a 2D y forzaba perpetuamente `pitch: 58°` y el rumbo de avance. Asimismo, la llamada 2D no redefinía `pitch: 0` ni `bearing: 0`.
     - **Solución implementada**: El modo de seguimiento de cámara se rige ahora **estrictamente por `appState.animCameraMode`** (independiente de si hay capas 3D encendidas). Al conmutar a 2D, se restauran explícitamente `pitch: 0`, `bearing: 0` y `offset: [0, 0]`, garantizando una transición inmediata y suave a vista cenital top-down tanto en reproducción como en scrubbing interactivo.

   4. **Iconografía Vectorial Minimalista y Neutral (Reemplazo Integral de Emojis)**:
      - **Objetivo**: Elevar la estética a un estándar institucional riguroso, sustituyendo todos los emojis informales por iconos vectoriales SVG limpios inspirados en Lucide/Feather con clase global .ui-icon.
      - **Diseño cromático**: Color neutro por defecto (--text-secondary: #94a3b8) que combina y resalta sobre el fondo glassmorphic oscuro; transición a blanco (#ffffff) en hover y a cian brillante (#38bdf8) o blanco en estado activo.
      - **Elementos renovados**: Selector de mapas base (Luna y Globo/Satélite), relieves DEM y edificaciones, botones 2D/3D y encuadre, herramientas de medición (distancia, área, limpiar, deshacer, finalizar), botones de captura HD, perfiles de diagnóstico, chips de telemetría HUD (recorrido, isovistas, área acumulada, cota topográfica e hitos) y estados de reproducción.
   5. **Corrección de Truncamiento en Nombres de Hitos Durante la Animación**:
      - **Causa del corte**: El contenedor flotante .anim-player-floating tenía un ancho estático de 680px y .chip-hito aplicaba max-width: 210px; overflow: hidden; text-overflow: ellipsis;, provocando que referencias largas (ej. *'Templo de San José y Plaza de la Reforma Agraria (a 28 m)'*) se cortaran con puntos suspensivos.
      - **Solución implementada**:
        1. Se eliminó la restricción max-width: 210px en .chip-hito, asignando max-width: none; flex-shrink: 0; white-space: nowrap; font-weight: 700; color: #fbbf24;.
        2. Se amplió el ancho dinámico del reproductor a width: min(860px, calc(100vw - 360px)) con contenedor de chips responsivo (overflow-x: auto sin barras de scroll invasivas).
        3. En pp.js (updateAnimationHUD), se vinculó elHito.title con el texto completo para garantizar lectura en tooltip flotante nativo en cualquier pantalla.


   6. **Velocidad de Reproducción 1/2x y Despliegue Múltiple de Hitos Sin Empalmes**:
      - **Velocidad 0.5x**: Se agregó la opción de velocidad 0.5x en el grupo de control de animación (btn-speed) permitiendo una inspección lenta y detallada del recorrido a lo largo del corredor.
      - **Hitos Múltiples Concurrentes**: Durante la animación, cuando el observador pasa cerca de varios hitos urbanos contiguos, el motor activa todos los marcadores simultáneamente con etiquetas ancladas en direcciones cardinales opuestas (bottom, top, left, right) para evitar cualquier empalme visual.
   7. **Optimización Responsiva Móvil del HUD de Animación (Cota e Hito en Línea 2)**:
      - **Estructura en 2 líneas limpias**:
        - **Línea 1**: Distancia (chip-dist), Isovista (chip-iso) y Acumulada (chip-area) ocupan el ancho superior con espacio reservado para el botón de minimizar (-). Se activan abreviaturas adaptables (Iso: y Acum:) en pantallas reducidas.
        - **Línea 2**: Cota topográfica (chip-elev) e Hito urbano (chip-hito) se ubican **uno al lado del otro en la misma línea**, aprovechando el 100% del ancho del contenedor sin desbordes ni cortes.
      - **Compatibilidad de escritorio**: La propiedad display: contents; en .telemetry-line-top y .telemetry-line-bottom preserva intacto el flujo horizontal continuo en pantallas de escritorio.
