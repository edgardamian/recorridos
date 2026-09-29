# Mapa Interactivo 2D / 3D • Isovistas Urbanas Morelia Norte-Sur

Aplicación web cartográfica moderna, modular e interactiva diseñada para la visualización y análisis espacial del **Corredor Norte-Sur de Morelia**, integrando **relieve topográfico 3D (DEM)** y **extrusión 3D de edificaciones basada en alturas reales**.

---

## 📁 Estructura del Proyecto

```text
mapa/
├── index.html          # Estructura semántica HTML5, panel lateral, reproductor de animación y controles
├── styles.css          # Estilos Glassmorphism Dark Theme, HUD de animación, micro-animaciones y diseño responsivo
├── app.js              # Lógica de carga asíncrona, MapLibre GL JS, capas 2D/3D, interactividad y motor de animación
├── README.md           # Guía técnica y de uso del proyecto
└── datos/              # Datos espaciales optimizados (formatos .geojson y .js estáticos)
    ├── metadata.js / metadata.json       # Métricas y estadísticas generales (ruta, centro inicial, alturas)
    ├── ruta.js / ruta.geojson            # Geometría LineString de la ruta peatonal (4.7 km)
    ├── referencias.js / referencias.geojson # Puntos de referencia e hitos urbanos (26 puntos)
    ├── envolvente.js / envolvente.geojson   # Polígono disuelto de la envolvente visual de isovistas (28.1 ha)
    ├── edificios.js / edificios.geojson     # 24,714 huellas de edificaciones con atributos 'altura', 'niveles', etc.
    └── animacion.js / animacion.json       # 235 cuadros secuenciales de isovistas instantáneas y métricas acumuladas (cada 20 m)
```

---

## 🚀 Cómo Visualizar el Mapa (100% Estático)

### Opción 1: ¡Doble Clic Directo! (Sin servidor ni terminal)
Simplemente haz **doble clic en `index.html`** desde el explorador de archivos de Windows.
- Se abrirá inmediatamente en tu navegador predeterminado (Chrome, Edge, Firefox, Brave).
- **No necesitas instalar nada, no necesitas abrir terminales ni ejecutar comandos.**
- Esto es posible gracias a que los datos en `datos/` están disponibles como scripts estáticos (`.js`), eludiendo las restricciones de CORS del protocolo `file://`.

### Opción 2: Con Servidor Local o Live Server (Opcional)
Si deseas desplegarlo en un servidor web local, en la red local o en GitHub Pages:
```bash
python -m http.server 8000
```
Y abre `http://localhost:8000`.

---

## 🎬 Controles de Animación e Isovistas Progresivas en Tiempo Real

Al abrir la aplicación, el mapa inicia como un **mapa interactivo normal 2D** para una navegación limpia. En la parte inferior central flota un discreto botón lanzador (**`🎬 Animación del Recorrido`**):

- **Al desplegar las herramientas:** El reproductor HUD se expande, aparece el marcador del observador y se proyecta el **polígono inicial de isovistas** del punto de partida.
- **Al minimizar las herramientas:** El reproductor se contrae nuevamente en el botón flotante inferior, pausando la animación y restaurando la visualización del mapa interactivo habitual.

1. **Aparición Progresiva de Isovistas:**
   - **Cono visual instantáneo:** Se proyecta en cian brillante (`#22d3ee`) y rota en tiempo real siguiendo el ángulo de avance (*bearing*) del peatón.
   - **Área acumulada progresiva:** Conforme avanza la animación, el área de visibilidad explorada se va dibujando y fusionando sobre el mapa en tono magenta/carmín (`#f43f5e`), mostrando exactamente la cuenca visual acumulada hasta ese punto.
2. **Marcador Dinámico de Observador:**
   - Puntero con halo pulsante e indicador direccional de rumbo que se desplaza fluidamente por el eje de la ruta.
3. **Controles Interactivos:**
   - **Play / Pause:** Inicia o detiene la reproducción continua (también con la tecla **Espacio**).
   - **Reset:** Vuelve al punto de partida (Norte).
   - **Barra de Progreso (Scrubber):** Permite saltar o arrastrar a cualquier punto de la ruta al instante.
   - **Velocidades:** Selección rápida de `1x`, `2x` o `4x`.
   - **Cámara Seguidora (Tracking 3D):** Cuando está activada (`🎥 Seguir`), en modo 3D la cámara se coloca **físicamente detrás del observador** (*chase camera* o perspectiva en tercera persona), orientando el ángulo de visión con rumbo suavizado en la dirección de la ruta (pitch 58°, zoom 16.2), permitiendo contemplar el cañón urbano y las edificaciones 3D flanqueando el avance.
   - **Alternador 3D / 2D (`🌐 Cámara 3D (Detrás)` / `📐 Vista 2D`):** Permite cambiar con un solo clic entre la cámara subjetiva 3D detrás del observador y la vista cenital ortogonal clásica.
4. **Telemetría en Vivo (HUD):**
   - **Distancia:** Kilómetros recorridos y porcentaje completado.
   - **Isovista Instantánea:** Superficie visible en el cuadro actual ($m^2$).
   - **Isovista Acumulada:** Cobertura visual total desbloqueada hasta el momento (en hectáreas).
   - **Hito Urbano Próximo:** Nombre del monumento o punto de interés más cercano y distancia en metros.

---

## 🌟 Componentes y Funcionalidades Adicionales

### 1. ⛰️ Relieve Topográfico 3D y Exageración (1x, 2x, 3x)
- **Fuente DEM:** *AWS Terrarium DEM* global.
- **Botones de Exageración:**
  - `Real (1x)`: Pendientes y orografía fiel a la escala real.
  - `2x`: Exageración moderada para acentuar el valle de Morelia.
  - `3x`: Exageración pronunciada para apreciar cuencas visuales y desniveles topográficos.

### 2. 🏢 Edificaciones 3D y Exageración Vertical
- **Capa `fill-extrusion`:** Generada sobre 24,714 huellas de edificaciones de Morelia.
- **Botones de Escala:**
  - `Real (1x)`: Altura calculada según el número de niveles y mediciones del polígono.
  - `2x` y `3x`: Multiplica la altura para destacar la densidad del cañón urbano.
- **Popups interactivos:** Clic sobre cualquier edificio para consultar FID, altura en metros y número de pisos.

### 3. 🗺️ Selector de Mapas Base
- **Carto Dark:** Modo oscuro optimizado para resaltar luces y conos de visibilidad.
- **OpenStreetMap:** Cartografía estándar con nombres de calles y detalles urbanos.
- **Carto Positron:** Mapa claro minimalista.
- **Esri Satelital:** Ortofoto aérea de alta resolución para cotejar edificaciones y vegetación real.

### 4. 🧭 Control de Perspectiva y Cámara
- **📐 Vista 2D:** Restablece la cámara a vista cenital ortogonal (pitch 0°, bearing 0°).
- **🌐 Perspectiva 3D:** Inclina la cámara a 58° oblicua para contemplar la volumetría.
- **🚶 Encuadrar Recorrido:** Ajusta automáticamente el zoom y encuadre para abarcar toda la ruta de norte a sur.

### 5. 🔍 Buscador en Vivo e Hitos Urbanos
- Filtra en tiempo real los 26 hitos urbanos.
- Clic en la lista ejecuta un vuelo suave (`flyTo`) hacia el hito y abre su popup descriptivo exclusivo (cerrando cualquier otro para evitar saturación visual).

---

## 🛠️ Optimización y Generación de Datos
- **Generación de Cuadros (`generar_datos_animacion.py`):** Precalculó 235 isovistas vectoriales a lo largo de la ruta usando Shapely y Rtree en menos de 30 segundos, comprimidos a solo 610 KB en `datos/animacion.js`.
- **Rendimiento 60 FPS:** En el navegador, la animación utiliza un arreglo preconstruido de features GeoJSON para actualizar `setData()` en menos de 0.2 ms sin recolección de basura ni caídas de fotogramas.
- **Reducción de coordenadas a 6 decimales:** Precisión sub-métrica (~10 cm), reduciendo el peso de `edificios.geojson` de **19 MB a 8.46 MB** (-55% de peso).
