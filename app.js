/**
 * ==============================================================================
 * APLICACIÓN PRINCIPAL DE VISUALIZACIÓN CARTOGRÁFICA INTERACTIVA 2D / 3D
 * Proyecto: Análisis de Isovistas Urbanas - Corredor Norte-Sur de Morelia
 * Tecnologías: MapLibre GL JS (v5), JavaScript ES6+ asíncrono, AWS Terrarium DEM
 * ==============================================================================
 * Este script carga de manera asíncrona todos los conjuntos de datos GeoJSON
 * desde la carpeta 'datos/', configura las fuentes y capas del mapa, administra
 * los modos de visualización 3D (relieve topográfico y extrusión de edificios por
 * altura) y provee interactividad completa mediante popups, filtros y controles de cámara.
 */

// ==============================================================================
// 1. CONFIGURACIÓN, RUTAS Y ESTADO GLOBAL DE LA APLICACIÓN
// ==============================================================================

/** Rutas relativas a los datos dentro de la carpeta 'datos/' */
const DATA_PATHS = {
    metadata: "datos/metadata.json",
    ruta: "datos/ruta.geojson",
    referencias: "datos/referencias.geojson",
    envolvente: "datos/envolvente.geojson",
    edificios: "datos/edificios.geojson",
    animacion: "datos/animacion.json"
};

/** Estado reactivo de las capas y la cámara */
const appState = {
    basemapMode: "dark",          // "dark" o "satellite"
    terrain3DActive: false,       // ¿Relieve DEM 3D activo?
    terrainExaggeration: 1.0,     // Factor de exageración del terreno DEM
    buildings3DActive: false,     // ¿Extrusión 3D de edificios activa?
    buildingsExaggeration: 1.0,   // Multiplicador de altura de edificios
    buildingsMasterVisible: true, // ¿Visibilidad general de edificios?
    landmarksLabelsVisible: false, // ¿Etiquetas de texto de hitos visibles?
    landmarksData: [],            // Almacén en memoria de puntos de referencia
    landmarkMarkers: [],          // Referencias a los marcadores HTML en el mapa
    activeLandmarkFid: null,      // FID del hito actualmente seleccionado/activo
    activePopup: null,            // Instancia del popup activo actualmente en pantalla
    // Estado de la animación de isovistas
    animData: null,               // Dataset con los 235 fotogramas
    animPlaying: false,           // ¿Animación reproduciéndose?
    animCurrentFrame: 0,          // Fotograma actual (0 a total-1)
    animSpeed: 1.0,               // Velocidad (1x, 2x, 4x)
    animCameraFollow: true,       // ¿Cámara sigue al observador?
    animCameraMode: "2d",         // Modo de seguimiento por defecto: "2d" (cenital) o "3d" (detrás del punto)
    animPlayerVisible: false,     // ¿Barra de controles visible? Inicia minimizado por defecto
    observerMarker: null,         // Marcador HTML del observador en el mapa
    prebuiltFeatures: [],         // Features GeoJSON precalculadas para 60fps constantes
    animTimer: null,              // Temporizador del bucle de animación
    // Estado de las herramientas de medición interactiva
    measure: {
        active: false,             // ¿Herramienta de medición activa?
        mode: null,                // 'distance' | 'area' | null
        coordinates: [],           // Coordenadas [lng, lat] de los vértices fijados
        markers: [],               // Marcadores HTML de los vértices en el mapa
        totalMarker: null,         // Marcador flotante con la tarjeta de resultado final
        isFinished: false,         // ¿Medición completada/cerrada?
        totalDistance: 0,          // Distancia acumulada en metros
        totalArea: 0               // Área acumulada en m²
    }
};

// Variable global para la instancia del mapa MapLibre
let map = null;

// Almacén de identificadores de las capas base de Carto Dark Matter para conmutación limpia
let cartoBaseLayerIds = [];


// ==============================================================================
// 2. INICIALIZACIÓN DEL MAPA CON MAPLIBRE GL JS
// ==============================================================================

/**
 * Inicializa el mapa base en modo cenital (2D) con estilo Carto Dark Matter.
 */
function initMap() {
    // Coordenadas iniciales por defecto (Centro del recorrido Morelia Norte-Sur)
    const initialCenter = [-101.1918, 19.7033];

    map = new maplibregl.Map({
        container: "map",
        // Estilo Carto Dark Matter: sin necesidad de tokens ni API keys de terceros
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: initialCenter,
        zoom: 14.8,
        pitch: 0,       // Vista cenital (ortogonal, 90° desde arriba)
        bearing: 0,     // Orientación norte
        maxPitch: 70,   // Límite de inclinación seguro que evita recorte de frustum y desaparición de capas
        maxZoom: 21,    // Límite superior de zoom seguro para sobre-escalado nítido
        attributionControl: false // Personalizado si se desea
    });

    // Agregar controles de navegación nativos (Zoom y brújula de orientación)
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    
    // Control de pantalla completa
    map.addControl(new maplibregl.FullscreenControl(), "top-left");
    
    // Control de escala métrica en la esquina inferior izquierda
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

    // Cuando el mapa y los estilos base terminen de cargarse, procesar los datos
    map.on("load", async () => {
        console.log("[MapLibre] Estilo base cargado exitosamente. Iniciando carga de datos GeoJSON...");
        await loadAllDatasets();
        setupLayers();
        setup3DFeatures();
        setupInteractivity();
        setupAnimation();
        setupUIEventListeners();
        setupMeasureTools();

        // Escuchar giros e inclinaciones manuales del mapa para mantener la orientación y UI en sincronía
        map.on("rotate", updateObserverArrowDirection);
        map.on("pitch", () => {
            const isPitch3D = map.getPitch() > 20;
            updateCamModeUI(isPitch3D);
        });

        hideLoadingOverlay();
    });
}


// ==============================================================================
// 3. CARGA ASÍNCRONA DE DATOS GEOJSON DESDE 'datos/'
// ==============================================================================

/**
 * Carga todos los archivos GeoJSON y metadatos en paralelo usando Promise.all.
 */
async function loadAllDatasets() {
    try {
        updateLoadingText("Cargando conjuntos de datos espaciales...", "Leyendo ruta, hitos, envolvente y edificaciones");

        // 1. Modo Estático (sin servidor / doble clic directo en index.html):
        // Se leen directamente las variables globales inyectadas por los scripts de datos/
        let metaRes = window.DATOS_METADATA;
        let rutaRes = window.DATOS_RUTA;
        let refRes = window.DATOS_REFERENCIAS;
        let envRes = window.DATOS_ENVOLVENTE;
        let edifRes = window.DATOS_EDIFICIOS;
        let animRes = window.DATOS_ANIMACION;

        // 2. Modo Servidor (fallback a fetch si los scripts no se incluyeron en el HTML):
        if (!metaRes || !rutaRes || !refRes || !envRes || !edifRes || !animRes) {
            [metaRes, rutaRes, refRes, envRes, edifRes, animRes] = await Promise.all([
                metaRes || fetch(DATA_PATHS.metadata).then(r => r.json()),
                rutaRes || fetch(DATA_PATHS.ruta).then(r => r.json()),
                refRes || fetch(DATA_PATHS.referencias).then(r => r.json()),
                envRes || fetch(DATA_PATHS.envolvente).then(r => r.json()),
                edifRes || fetch(DATA_PATHS.edificios).then(r => r.json()),
                animRes || fetch(DATA_PATHS.animacion).then(r => r.json()).catch(() => null)
            ]);
        }

        appState.animData = animRes;

        console.log("[Datos] Metadatos cargados:", metaRes);
        console.log(`[Datos] Edificios: ${edifRes.features.length} | Hitos: ${refRes.features.length}`);

        // Actualizar estadísticas en las tarjetas del panel de control
        updateStatsUI(metaRes, edifRes);

        // Guardar hitos en el estado para el buscador
        appState.landmarksData = refRes.features;
        renderLandmarksList(refRes.features);

        // Registrar las fuentes GeoJSON en el mapa con parámetros balanceados para evitar desborde de vértices WebGL (65,535) y caídas de teselas
        map.addSource("ruta_src", { type: "geojson", data: rutaRes, tolerance: 0, buffer: 128, maxzoom: 20 });
        map.addSource("referencias_src", { type: "geojson", data: refRes, tolerance: 0, buffer: 128, maxzoom: 20 });
        map.addSource("envolvente_src", { type: "geojson", data: envRes, tolerance: 0, buffer: 128, maxzoom: 20 });
        map.addSource("edificios_src", {
            type: "geojson",
            data: edifRes,
            tolerance: 0.08,    // Preserva las esquinas y detalles de cada edificio sin inflar el búfer de vértices WebGL
            buffer: 64,         // Búfer idóneo: evita cortes en los bordes de teselas sin duplicar innecesariamente polígonos
            maxzoom: 20         // Detalle submétrico (z20 = ~15 cm/pixel). Zooms más cercanos sobre-escalan con máxima fidelidad
        });

        // Agregar marcadores visuales para el Punto de Inicio y Punto de Fin
        if (metaRes.punto_inicio && metaRes.punto_fin) {
            setupStartEndMarkers(metaRes.punto_inicio, metaRes.punto_fin);
        }

    } catch (error) {
        console.error("[Error] Falló la carga de datos GeoJSON:", error);
        updateLoadingText("Error al cargar los datos", "Verifica que la carpeta 'datos/' contenga todos los archivos.");
    }
}


// ==============================================================================
// 4. CONFIGURACIÓN Y ESTILIZADO DE CAPAS (2D Y 3D)
// ==============================================================================

/**
 * Agrega y estiliza las capas vectoriales sobre el mapa.
 */
function setupLayers() {
    // Identificar todas las capas base del estilo Carto Dark Matter para conmutación limpia
    cartoBaseLayerIds = map.getStyle().layers
        .filter(l => l.source === "carto" || l.id === "background")
        .map(l => l.id);

    // -------------------------------------------------------------------------
    // CAPA 0: MAPA SATELITAL (ESRI WORLD IMAGERY - ALTA RESOLUCIÓN)
    // -------------------------------------------------------------------------
    map.addSource("satellite_src", {
        type: "raster",
        tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        ],
        tileSize: 256,
        maxzoom: 19
    });

    map.addLayer({
        id: "satellite-layer",
        type: "raster",
        source: "satellite_src",
        layout: { visibility: "none" } // Inicia apagada (Dark Matter por defecto)
    });

    // -------------------------------------------------------------------------
    // CAPA 1: EDIFICACIONES URBANAS (2D BASE)
    // -------------------------------------------------------------------------
    map.addLayer({
        id: "edificios-fill",
        type: "fill",
        source: "edificios_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#1e293b",
            "fill-opacity": 0.85,
            "fill-outline-color": "rgba(51, 65, 85, 0.4)"
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 2: ENVOLVENTE VISUAL ACUMULADA (ISOVISTAS DISUELTAS)
    // Polígono de cobertura visual combinada a lo largo del recorrido.
    // -------------------------------------------------------------------------
    map.addLayer({
        id: "envolvente-fill",
        type: "fill",
        source: "envolvente_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.38
        }
    });

    // Borde delimitador de la envolvente
    map.addLayer({
        id: "envolvente-line",
        type: "line",
        source: "envolvente_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#f87171",
            "line-width": 2,
            "line-dasharray": [2, 1]
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 2.5: ÁREAS DE ANIMACIÓN DE ISOVISTAS (PROGRESIVA E INSTANTÁNEA)
    // -------------------------------------------------------------------------
    // Fuente y capas para el área acumulada progresiva descubierta
    map.addSource("anim_acum_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addLayer({
        id: "anim-acum-fill",
        type: "fill",
        source: "anim_acum_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.38
        }
    });

    map.addLayer({
        id: "anim-acum-line",
        type: "line",
        source: "anim_acum_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#f87171",
            "line-width": 1.6,
            "line-dasharray": [2, 1]
        }
    });

    // Fuente y capas para la isovista instantánea (campo visual actual en tiempo real)
    map.addSource("anim_actual_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    // Resplandor difuso exterior del haz visual
    map.addLayer({
        id: "anim-actual-glow",
        type: "line",
        source: "anim_actual_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 7,
            "line-blur": 3,
            "line-opacity": 0.65
        }
    });

    // Relleno del campo visual actual
    map.addLayer({
        id: "anim-actual-fill",
        type: "fill",
        source: "anim_actual_src",
        layout: { visibility: "visible" },
        paint: {
            "fill-color": "#38bdf8",
            "fill-opacity": 0.5
        }
    });

    // Borde nítido blanco del campo visual actual
    map.addLayer({
        id: "anim-actual-line",
        type: "line",
        source: "anim_actual_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#ffffff",
            "line-width": 2
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 3: RUTA PEATONAL DEL OBSERVADOR
    // Trazado del recorrido norte a sur con efecto resplandor (glow).
    // -------------------------------------------------------------------------
    // Halo resplandeciente exterior
    map.addLayer({
        id: "ruta-halo",
        type: "line",
        source: "ruta_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 8,
            "line-opacity": 0.35,
            "line-blur": 3
        }
    });

    // Línea central sólida
    map.addLayer({
        id: "ruta-line",
        type: "line",
        source: "ruta_src",
        layout: { visibility: "visible" },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 3.8
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 4: PUNTOS DE REFERENCIA (HITOS DESTACADOS EN AMARILLO)
    // -------------------------------------------------------------------------
    map.addLayer({
        id: "referencias-circles",
        type: "circle",
        source: "referencias_src",
        layout: { visibility: "visible" },
        paint: {
            "circle-color": "#fbbf24",
            "circle-radius": 6.5,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 2.5
        }
    });

    // Capa de halo resplandeciente para el hito actualmente seleccionado (activo)
    map.addLayer({
        id: "referencias-active-glow",
        type: "circle",
        source: "referencias_src",
        layout: { visibility: "visible" },
        filter: ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"],
        paint: {
            "circle-color": "#fbbf24",
            "circle-radius": 15,
            "circle-opacity": 0.45,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5
        }
    });

    // -------------------------------------------------------------------------
    // CAPA 4.1: ETIQUETAS NATIVAS DE HITOS EN WEBGL (CERO RETRASO A 60+ FPS)
    // Renderizadas por GPU dentro del mismo flujo de fotogramas que el mapa y el relieve
    // -------------------------------------------------------------------------
    map.addLayer({
        id: "referencias-labels",
        type: "symbol",
        source: "referencias_src",
        layout: {
            "visibility": appState.landmarksLabelsVisible ? "visible" : "none",
            "text-field": ["get", "nombre"],
            "text-font": ["Montserrat Medium", "Open Sans Regular"],
            "text-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                12, 10.5,
                14, 11.5,
                16, 13,
                18, 14.5
            ],
            "text-offset": [0, -1.25],
            "text-anchor": "bottom",
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-padding": 3,
            "text-optional": true
        },
        paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "#090d16",
            "text-halo-width": 2.2,
            "text-halo-blur": 0.5
        }
    });

    // Etiqueta nativa destacada para el hito actualmente seleccionado (activo)
    map.addLayer({
        id: "referencias-active-label",
        type: "symbol",
        source: "referencias_src",
        layout: {
            "visibility": "visible",
            "text-field": ["get", "nombre"],
            "text-font": ["Open Sans Bold", "Montserrat Medium"],
            "text-size": 13.5,
            "text-offset": [0, -1.35],
            "text-anchor": "bottom",
            "text-pitch-alignment": "viewport",
            "text-rotation-alignment": "viewport",
            "text-allow-overlap": true,
            "text-ignore-placement": true
        },
        filter: ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"],
        paint: {
            "text-color": "#fbbf24",
            "text-halo-color": "#090d16",
            "text-halo-width": 2.8,
            "text-halo-blur": 0.5
        }
    });

    // -------------------------------------------------------------------------
    // CAPAS DE MEDICIÓN INTERACTIVA (DISTANCIA Y ÁREA)
    // -------------------------------------------------------------------------
    map.addSource("measure_polygon_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addSource("measure_line_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addSource("measure_rubberband_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    map.addSource("measure_points_src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
    });

    // Relleno de polígono medido
    map.addLayer({
        id: "measure-polygon-fill",
        type: "fill",
        source: "measure_polygon_src",
        paint: {
            "fill-color": "#38bdf8",
            "fill-opacity": 0.24
        }
    });

    // Contorno de polígono medido
    map.addLayer({
        id: "measure-polygon-stroke",
        type: "line",
        source: "measure_polygon_src",
        paint: {
            "line-color": "#38bdf8",
            "line-width": 2.2,
            "line-dasharray": [2, 2]
        }
    });

    // Resplandor de línea de medición
    map.addLayer({
        id: "measure-line-glow",
        type: "line",
        source: "measure_line_src",
        paint: {
            "line-color": "#38bdf8",
            "line-width": 7,
            "line-opacity": 0.35
        }
    });

    // Línea de medición sólida
    map.addLayer({
        id: "measure-line-main",
        type: "line",
        source: "measure_line_src",
        layout: {
            "line-cap": "round",
            "line-join": "round"
        },
        paint: {
            "line-color": "#38bdf8",
            "line-width": 3.6
        }
    });

    // Guía elástica dinámica (rubberband) bajo el cursor
    map.addLayer({
        id: "measure-rubberband-line",
        type: "line",
        source: "measure_rubberband_src",
        layout: {
            "line-cap": "round",
            "line-join": "round"
        },
        paint: {
            "line-color": "#fbbf24",
            "line-width": 2.2,
            "line-dasharray": [3, 2]
        }
    });

    // Vértices de medición
    map.addLayer({
        id: "measure-points-circle",
        type: "circle",
        source: "measure_points_src",
        paint: {
            "circle-radius": 5.5,
            "circle-color": "#0f172a",
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#38bdf8"
        }
    });
}


// ==============================================================================
// 5. CONTROLADORES 3D (TERRENO DEM Y EDIFICIOS EXTRUIDOS)
// ==============================================================================

/**
 * Prepara las fuentes y capas necesarias para visualización 3D:
 * 1. Fuente DEM Raster para Terreno 3D (AWS Terrarium).
 * 2. Capa 'fill-extrusion' para edificios con altura variable.
 */
function setup3DFeatures() {
    // 1. Agregar la fuente global de elevación DEM (tiles Terrarium en AWS)
    // maxzoom: 14 evita discrepancias de resolución con las capas base y la advertencia WebGL de elevación
    map.addSource("terrain-dem-src", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 14
    });

    // 2. Agregar la capa de extrusión 3D de edificios vinculada a 'altura'
    // Se inserta antes de 'referencias-circles' para que los hitos y la ruta permanezcan visibles.
    map.addLayer({
        id: "edificios-3d",
        type: "fill-extrusion",
        source: "edificios_src",
        layout: {
            visibility: "none" // Inicia apagada en modo 2D cenital
        },
        paint: {
            // Rampa de color dinámica interpolada según la altura en metros del edificio
            "fill-extrusion-color": [
                "interpolate",
                ["linear"],
                ["coalesce", ["get", "altura"], 3],
                0,  "#1e293b", // Lotes o estructuras rasas
                3,  "#334155", // 1 nivel (~3 m)
                6,  "#475569", // 2 niveles (~6 m)
                9,  "#64748b", // 3 niveles (~9 m)
                12, "#0284c7", // 4 niveles (~12 m)
                20, "#38bdf8", // Media altura (~20 m)
                35, "#f59e0b"  // Torres o hitos altos (~35 m)
            ],
            // Altura de extrusión vertical con mínimo garantizado (3.0 m) para evitar que el terreno tape edificios bajos
            "fill-extrusion-height": [
                "*",
                ["max", ["coalesce", ["get", "altura"], 3.5], 3.0],
                appState.buildingsExaggeration
            ],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.90
        }
    }, "referencias-circles");
}

/**
 * Cambia el mapa base entre estilo oscuro (Carto) e imagen satelital de alta resolución (ESRI).
 * Oculta completamente las capas del mapa base oscuro al activar satélite para evitar que queden
 * por debajo, se filtren visualmente o causen artefactos/desaparición en perspectiva 3D.
 * @param {'dark' | 'satellite'} mode - Estilo de mapa base deseado
 */
function setBasemap(mode) {
    if (!map) return;
    appState.basemapMode = mode;
    const btnDark = document.getElementById("btn-bm-dark");
    const btnSat = document.getElementById("btn-bm-satellite");

    if (mode === "satellite") {
        if (map.getLayer("satellite-layer")) {
            map.setLayoutProperty("satellite-layer", "visibility", "visible");
        }
        // Ocultar todas las capas base de Carto para evitar que queden por debajo
        cartoBaseLayerIds.forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", "none");
            }
        });
        if (btnDark) btnDark.classList.remove("active");
        if (btnSat) btnSat.classList.add("active");
    } else {
        if (map.getLayer("satellite-layer")) {
            map.setLayoutProperty("satellite-layer", "visibility", "none");
        }
        // Restaurar visibilidad de las capas base Carto Dark
        cartoBaseLayerIds.forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", "visible");
            }
        });
        if (btnDark) btnDark.classList.add("active");
        if (btnSat) btnSat.classList.remove("active");
    }
}

/**
 * Aplica la exageración del relieve mediante los botones (Real 1x, 2x, 3x).
 * Si el relieve 3D está apagado, lo enciende automáticamente.
 * @param {number|string} val - Factor de escala de relieve (1.0, 2.0, 3.0)
 */
function setTerrainExaggeration(val) {
    const num = parseFloat(val);
    appState.terrainExaggeration = num;

    // Actualizar botones UI
    document.querySelectorAll('#row-terrain-exag .btn-exag').forEach(btn => {
        if (parseFloat(btn.dataset.val) === num) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Si el terreno 3D no está encendido, activarlo automáticamente
    if (!appState.terrain3DActive) {
        toggleTerrain3D(true);
    } else if (map) {
        map.setTerrain({ source: "terrain-dem-src", exaggeration: appState.terrainExaggeration });
    }
}

/**
 * Aplica el multiplicador de altura de los edificios mediante los botones (Real 1x, 2x, 3x).
 * Si los edificios 3D están apagados, los enciende automáticamente.
 * @param {number|string} val - Factor de escala de altura (1.0, 2.0, 3.0)
 */
function setBuildingsExaggeration(val) {
    const num = parseFloat(val);
    appState.buildingsExaggeration = num;

    // Actualizar botones UI
    document.querySelectorAll('#row-buildings-exag .btn-exag').forEach(btn => {
        if (parseFloat(btn.dataset.val) === num) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Si los edificios 3D no están encendidos, activarlos automáticamente
    if (!appState.buildings3DActive) {
        toggleBuildings3D(true);
    }

    if (map && map.getLayer("edificios-3d")) {
        map.setPaintProperty("edificios-3d", "fill-extrusion-height", [
            "*",
            ["max", ["coalesce", ["get", "altura"], 3.5], 3.0],
            appState.buildingsExaggeration
        ]);
    }
}

const updateTerrainExaggeration = setTerrainExaggeration;
const updateBuildingsExaggeration = setBuildingsExaggeration;

/**
 * Activa o desactiva la elevación topográfica del Terreno 3D.
 * Aplica el factor actual de exageración (appState.terrainExaggeration).
 * @param {boolean} [forceState] - Estado opcional para forzar encendido o apagado
 */
function toggleTerrain3D(forceState) {
    if (forceState !== undefined) {
        appState.terrain3DActive = forceState;
    } else {
        appState.terrain3DActive = !appState.terrain3DActive;
    }

    const chk = document.getElementById("chk-terreno-3d");
    if (chk) chk.checked = appState.terrain3DActive;

    try {
        if (appState.terrain3DActive) {
            map.setTerrain({ source: "terrain-dem-src", exaggeration: appState.terrainExaggeration });
            if (map.setSourceTileLodParams) {
                map.setSourceTileLodParams(10, 4);
            }
        } else {
            // Desactivar elevación y regresar a plano 2D
            map.setTerrain(null);
        }
    } catch (e) {
        console.warn("[Terreno 3D] Error al cambiar estado:", e);
    }
}

/**
 * Activa o desactiva la extrusión volumétrica 3D de los edificios.
 * @param {boolean} [forceState] - Estado opcional para forzar encendido o apagado
 */
function toggleBuildings3D(forceState) {
    if (forceState !== undefined) {
        appState.buildings3DActive = forceState;
    } else {
        appState.buildings3DActive = !appState.buildings3DActive;
    }

    const chk = document.getElementById("chk-edificios-3d");
    if (chk) chk.checked = appState.buildings3DActive;

    try {
        if (appState.buildings3DActive) {
            // Mostrar capa 3D si la visibilidad general de edificios está activa
            if (appState.buildingsMasterVisible) {
                map.setLayoutProperty("edificios-3d", "visibility", "visible");
                map.setLayoutProperty("edificios-fill", "visibility", "none");
            }
        } else {
            // Ocultar capa 3D y restaurar capa plana 2D
            map.setLayoutProperty("edificios-3d", "visibility", "none");
            if (appState.buildingsMasterVisible) {
                map.setLayoutProperty("edificios-fill", "visibility", "visible");
            }
        }
    } catch (e) {
        console.warn("[Edificios 3D] Error al cambiar estado:", e);
    }
}

/**
 * Ajusta la perspectiva de la cámara entre vista cenital (2D) y oblicua (3D).
 * En 3D, orienta la cámara DETRÁS del observador con pitch de 58° si hay recorrido activo.
 * @param {'2d' | '3d' | 'fit'} mode - Modo deseado
 */
function setCameraView(mode) {
    if (!map) return;
    if (mode === "2d") {
        appState.animCameraMode = "2d";
        map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
        updateCamModeUI(false);
    } else if (mode === "3d") {
        appState.animCameraMode = "3d";
        // Si los edificios 3D están apagados, activarlos para enriquecer la experiencia visual
        if (!appState.buildings3DActive) {
            toggleBuildings3D(true);
        }
        let targetCenter = [-101.1918, 19.7033];
        let targetBearing = -15;

        // Si tenemos datos de animación, ubicarse exactamente DETRÁS del punto del observador
        if (appState.animData && appState.animData.frames) {
            const curFrame = appState.animData.frames[appState.animCurrentFrame] || appState.animData.frames[0];
            targetCenter = curFrame.coords;
            targetBearing = curFrame.cam_bearing !== undefined ? curFrame.cam_bearing : curFrame.bearing;
        }

        const offsetY = Math.min(60, Math.round(window.innerHeight * 0.08));
        map.easeTo({
            center: targetCenter,
            pitch: 58,
            bearing: targetBearing,
            zoom: Math.max(16.2, map.getZoom()),
            offset: [0, offsetY],
            duration: 900
        });
        updateCamModeUI(true);
    } else if (mode === "fit") {
        // Encuadra toda la extensión de la ruta peatonal
        const rutaSource = map.getSource("ruta_src");
        if (rutaSource && rutaSource._data) {
            const coords = rutaSource._data.features[0].geometry.coordinates;
            const bounds = coords.reduce((b, coord) => b.extend(coord), new maplibregl.LngLatBounds(coords[0], coords[0]));
            map.fitBounds(bounds, { padding: 60, duration: 1000 });
        }
    }
}

/**
 * Alterna entre modo de cámara 3D (detrás del punto) y 2D (cenital Norte).
 */
function toggleCameraMode(force3D) {
    if (force3D !== undefined) {
        appState.animCameraMode = force3D ? "3d" : "2d";
    } else {
        appState.animCameraMode = appState.animCameraMode === "3d" ? "2d" : "3d";
    }

    if (appState.animCameraMode === "3d") {
        // Si los edificios 3D están apagados, activarlos para enriquecer la experiencia visual
        if (!appState.buildings3DActive) {
            toggleBuildings3D(true);
        }
        setCameraView("3d");
    } else {
        setCameraView("2d");
    }
}

/**
 * Actualiza la apariencia y texto del botón de modo de cámara (3D / 2D) en la barra de animación.
 */
function updateCamModeUI(is3D) {
    const btn = document.getElementById("btn-anim-cam-mode");
    const icon = document.getElementById("anim-cam-mode-icon");
    const text = document.getElementById("anim-cam-mode-text");

    if (btn) {
        if (is3D) {
            btn.classList.add("active");
            if (icon) icon.innerText = "🌐";
            if (text) text.innerText = "Cámara 3D (Detrás)";
        } else {
            btn.classList.remove("active");
            if (icon) icon.innerText = "📐";
            if (text) text.innerText = "Vista 2D (Cenital)";
        }
    }
}

/**
 * Actualiza el ángulo visual de la flecha direccional del observador respecto a la rotación de la cámara.
 */
function updateObserverArrowDirection() {
    if (!appState.animData || !appState.animData.frames || !map) return;
    const frame = appState.animData.frames[appState.animCurrentFrame];
    if (!frame) return;

    const arrow = document.getElementById("observer-heading-arrow");
    if (arrow) {
        const curCamBearing = map.getBearing();
        const relHeading = ((frame.bearing - curCamBearing) + 360) % 360;
        arrow.style.transform = `rotate(${relHeading}deg)`;
    }
}


// ==============================================================================
// 6. POPUPS INTERACTIVOS Y EVENTOS DEL MOUSE
// ==============================================================================

/**
 * Configura los eventos de click y hover en las geometrías del mapa.
 */
function setupInteractivity() {
    // -------------------------------------------------------------------------
    // 1. Clic en Hitos / Puntos de Referencia y sus Etiquetas Nativas
    // -------------------------------------------------------------------------
    ["referencias-circles", "referencias-labels", "referencias-active-label"].forEach(layerId => {
        map.on("click", layerId, (e) => {
            if (appState.measure && appState.measure.active) return;
            if (!e.features || !e.features.length) return;
            const feat = e.features[0];
            const coords = feat.geometry.coordinates.slice();
            const props = feat.properties || {};
            showLandmarkPopup(coords, props.nombre || "Hito Urbano", props.fid || "");
        });

        map.on("mouseenter", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
            if (appState.measure && appState.measure.active) return;
            map.getCanvas().style.cursor = "";
        });
    });

    // -------------------------------------------------------------------------
    // 2. Eventos nativos de capas de edificios para cursor inmediato
    // -------------------------------------------------------------------------
    map.on("mouseenter", "edificios-3d", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "edificios-3d", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "edificios-fill", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "edificios-fill", () => {
        if (appState.measure && appState.measure.active) return;
        map.getCanvas().style.cursor = "";
    });

    // -------------------------------------------------------------------------
    // 3. Selección infalible de edificios (Búfer de 8px + Tolerancia de arrastre)
    //    Evita clics perdidos en perspectiva 3D o por leve vibración del cursor
    // -------------------------------------------------------------------------
    let lastSelectionTimestamp = 0;

    function handleBuildingSelection(point, lngLat) {
        if (appState.measure && appState.measure.active) return;
        const now = Date.now();
        if (now - lastSelectionTimestamp < 180) return; // Prevenir disparos duplicados

        // Si se hizo clic sobre un hito o su etiqueta, las capas de hitos ya lo atienden
        const refHits = map.queryRenderedFeatures([
            [point.x - 8, point.y - 8],
            [point.x + 8, point.y + 8]
        ], { layers: ["referencias-circles", "referencias-labels", "referencias-active-label"] });
        if (refHits.length > 0) return;

        // Determinar capas activas de edificios
        const targetLayers = [];
        if (appState.buildings3DActive && map.getLayer("edificios-3d")) {
            targetLayers.push("edificios-3d");
        } else if (map.getLayer("edificios-fill") && map.getLayoutProperty("edificios-fill", "visibility") !== "none") {
            targetLayers.push("edificios-fill");
        }

        if (targetLayers.length === 0) return;

        // Búsqueda en caja delimitadora de 8px alrededor del punto
        const hits = map.queryRenderedFeatures([
            [point.x - 8, point.y - 8],
            [point.x + 8, point.y + 8]
        ], { layers: targetLayers });

        if (hits.length > 0) {
            lastSelectionTimestamp = now;
            showBuildingPopup(lngLat, hits[0].properties || {});
        }
    }

    // Clic estándar de MapLibre
    map.on("click", (e) => {
        if (appState.measure && appState.measure.active) {
            handleMeasureMapClick(e);
            return;
        }
        handleBuildingSelection(e.point, e.lngLat);
    });

    // Doble clic para finalizar medición
    map.on("dblclick", (e) => {
        if (appState.measure && appState.measure.active) {
            e.preventDefault();
            finishMeasurement();
        }
    });

    // Rastreo de gesto (mousedown -> mouseup):
    // Si el usuario presionó y soltó con un desplazamiento <= 8px y < 450ms,
    // se trata como clic intencional (supera la supresión de clic por paneo)
    let pointerDownPos = null;
    let pointerDownTime = 0;

    map.on("mousedown", (e) => {
        pointerDownPos = { x: e.point.x, y: e.point.y };
        pointerDownTime = Date.now();
    });

    map.on("mouseup", (e) => {
        if (appState.measure && appState.measure.active) return;
        if (!pointerDownPos) return;
        const dx = e.point.x - pointerDownPos.x;
        const dy = e.point.y - pointerDownPos.y;
        const dist = Math.hypot(dx, dy);
        const duration = Date.now() - pointerDownTime;

        if (dist <= 8 && duration < 450) {
            handleBuildingSelection(e.point, e.lngLat);
        }
        pointerDownPos = null;
    });

    // Cursor reactivo en movimiento con requestAnimationFrame para 60fps constantes
    let hoverPending = false;
    map.on("mousemove", (e) => {
        if (appState.measure && appState.measure.active) {
            handleMeasureMouseMove(e);
            return;
        }

        if (hoverPending) return;
        hoverPending = true;
        requestAnimationFrame(() => {
            hoverPending = false;
            if (!map || (appState.measure && appState.measure.active)) return;

            const checkLayers = [];
            if (map.getLayer("referencias-circles")) checkLayers.push("referencias-circles");
            if (appState.buildings3DActive && map.getLayer("edificios-3d")) {
                checkLayers.push("edificios-3d");
            } else if (map.getLayer("edificios-fill") && map.getLayoutProperty("edificios-fill", "visibility") !== "none") {
                checkLayers.push("edificios-fill");
            }

            if (checkLayers.length === 0) {
                map.getCanvas().style.cursor = "";
                return;
            }

            const hits = map.queryRenderedFeatures([
                [e.point.x - 6, e.point.y - 6],
                [e.point.x + 6, e.point.y + 6]
            ], { layers: checkLayers });

            if (hits.length > 0) {
                map.getCanvas().style.cursor = "pointer";
            } else {
                map.getCanvas().style.cursor = "";
            }
        });
    });
}

/**
 * Despliega un popup con la información del hito o punto de referencia.
 * Desactiva cualquier hito previamente activo antes de mostrar el nuevo.
 */
function showLandmarkPopup(coords, nombre, fid) {
    // 1. Desactivar el hito previo cerrando su popup activo
    if (appState.activePopup) {
        appState.activePopup.remove();
        appState.activePopup = null;
    }

    // 2. Actualizar ID del hito activo en el estado
    appState.activeLandmarkFid = fid;

    // 3. Resaltar en el mapa el hito activo (halo resplandeciente y etiqueta dorada)
    if (map && map.getLayer("referencias-active-glow")) {
        map.setFilter("referencias-active-glow", [
            "==",
            ["to-string", ["coalesce", ["get", "fid"], ""]],
            String(fid)
        ]);
    }
    if (map && map.getLayer("referencias-active-label")) {
        map.setFilter("referencias-active-label", [
            "==",
            ["to-string", ["coalesce", ["get", "fid"], ""]],
            String(fid)
        ]);
    }

    // 4. Desactivar el hito anterior en la lista lateral y activar el nuevo
    document.querySelectorAll(".landmark-list-item").forEach(item => {
        if (String(item.dataset.fid) === String(fid)) {
            item.classList.add("active");
            item.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
            item.classList.remove("active");
        }
    });

    const html = `
        <div style="padding: 4px 6px;">
            <div style="font-size:10px; font-weight:700; color:#fbbf24; background:rgba(251,191,36,0.15); padding:2px 7px; border-radius:4px; display:inline-block; margin-bottom:5px; text-transform:uppercase;">📍 Hito Urbano #${fid}</div>
            <div style="font-size:14px; font-weight:700; color:#f8fafc; line-height:1.3; margin-bottom:6px;">${nombre}</div>
            <div style="font-size:11px; color:#94a3b8; display:flex; flex-direction:column; gap:2px;">
                <span><strong>Latitud:</strong> ${coords[1].toFixed(6)}° N</span>
                <span><strong>Longitud:</strong> ${coords[0].toFixed(6)}° W</span>
            </div>
        </div>
    `;

    const popup = new maplibregl.Popup({ offset: 12, closeButton: true })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);

    appState.activePopup = popup;

    // Al cerrar el popup del hito activo, apagar el resalte
    popup.on("close", () => {
        if (appState.activeLandmarkFid === fid) {
            appState.activeLandmarkFid = null;
            appState.activePopup = null;
            if (map && map.getLayer("referencias-active-glow")) {
                map.setFilter("referencias-active-glow", ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"]);
            }
            if (map && map.getLayer("referencias-active-label")) {
                map.setFilter("referencias-active-label", ["==", ["to-string", ["coalesce", ["get", "fid"], ""]], "__none__"]);
            }
            document.querySelectorAll(".landmark-list-item").forEach(item => {
                item.classList.remove("active");
            });
        }
    });
}

/**
 * Despliega un popup con los detalles del edificio (altura, niveles, fid).
 */
function showBuildingPopup(lngLat, props) {
    if (appState.activePopup) {
        appState.activePopup.remove();
        appState.activePopup = null;
    }

    const fid = props.fid || "S/N";
    const altura = props.altura !== undefined && props.altura !== null ? `${props.altura} m` : "Sin dato";
    const niveles = props.niveles || "1";
    const bloque = props.bloque || "A";

    const html = `
        <div style="padding: 4px 6px; min-width: 175px;">
            <div style="font-size:10px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.15); padding:2px 7px; border-radius:4px; display:inline-block; margin-bottom:5px; text-transform:uppercase;">🏢 Edificación #${fid}</div>
            <div style="font-size:16px; font-weight:800; color:#f8fafc; margin-bottom:6px;">
                ${altura} <span style="font-size:11.5px; font-weight:500; color:#94a3b8;">de altura</span>
            </div>
            <div style="font-size:11.5px; color:#cbd5e1; display:flex; flex-direction:column; gap:3px;">
                <span><strong>Niveles / Pisos:</strong> ${niveles}</span>
                <span><strong>Bloque:</strong> ${bloque}</span>
            </div>
        </div>
    `;

    const popup = new maplibregl.Popup({ offset: 10, closeButton: true })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map);

    appState.activePopup = popup;
}


// ==============================================================================
// 7. MARCADORES DE INICIO Y FIN & ETIQUETAS HTML
// ==============================================================================

/**
 * Configura los marcadores de Inicio y Fin con estilos personalizados y animación.
 */
function setupStartEndMarkers(ptoInicio, ptoFin) {
    // Marcador de Inicio (Verde)
    const elInicio = document.createElement("div");
    elInicio.className = "marker-start-end";
    elInicio.innerHTML = `<div style="width:14px; height:14px; background:#10b981; border:3px solid #0f172a; border-radius:50%; box-shadow:0 0 14px #10b981;"></div>`;
    
    new maplibregl.Marker({ element: elInicio })
        .setLngLat(ptoInicio.coords)
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${ptoInicio.nombre}</strong>`))
        .addTo(map);

    // Marcador de Fin (Rojo)
    const elFin = document.createElement("div");
    elFin.className = "marker-start-end";
    elFin.innerHTML = `<div style="width:14px; height:14px; background:#ef4444; border:3px solid #0f172a; border-radius:50%; box-shadow:0 0 14px #ef4444;"></div>`;

    new maplibregl.Marker({ element: elFin })
        .setLngLat(ptoFin.coords)
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${ptoFin.nombre}</strong>`))
        .addTo(map);
}

/**
 * Alterna la visibilidad de todas las etiquetas nativas de hitos a la vez.
 * Renderizadas directamente en WebGL por MapLibre para 0 ms de retraso en paneo y animación.
 */
function toggleAllLandmarkNames() {
    appState.landmarksLabelsVisible = !appState.landmarksLabelsVisible;
    const btn = document.getElementById("btn-toggle-names");
    const chkRef = document.getElementById("chk-referencias");
    const isMasterVisible = !chkRef || chkRef.checked;
    const vis = (appState.landmarksLabelsVisible && isMasterVisible) ? "visible" : "none";

    if (map && map.getLayer("referencias-labels")) {
        map.setLayoutProperty("referencias-labels", "visibility", vis);
    }

    if (btn) {
        if (appState.landmarksLabelsVisible) {
            btn.classList.add("active");
            btn.innerHTML = `<span>🏷️</span> Ocultar Nombres de Hitos`;
        } else {
            btn.classList.remove("active");
            btn.innerHTML = `<span>🏷️</span> Mostrar Nombres de Hitos (Off)`;
        }
    }
}


// ==============================================================================
// 8. VINCULACIÓN CON LA INTERFAZ DE USUARIO (UI EVENT LISTENERS)
// ==============================================================================

/**
 * Vincula los checkboxes, botones y formularios de la interfaz gráfica.
 */
function setupUIEventListeners() {
    // 0. Selector de Mapa Base (Oscuro vs Satélite)
    const btnBmDark = document.getElementById("btn-bm-dark");
    if (btnBmDark) btnBmDark.addEventListener("click", () => setBasemap("dark"));

    const btnBmSat = document.getElementById("btn-bm-satellite");
    if (btnBmSat) btnBmSat.addEventListener("click", () => setBasemap("satellite"));

    // 1. Botones de Exageración (Relieve Real 1x, 2x, 3x / Edificios Real 1x, 2x, 3x)
    document.querySelectorAll(".btn-exag").forEach(btn => {
        btn.addEventListener("click", () => {
            const type = btn.dataset.type;
            const val = btn.dataset.val;
            if (type === "terrain") {
                setTerrainExaggeration(val);
            } else if (type === "buildings") {
                setBuildingsExaggeration(val);
            }
        });
    });

    // 2. Switches dentro del panel lateral
    const chkTerr = document.getElementById("chk-terreno-3d");
    if (chkTerr) chkTerr.addEventListener("change", (e) => toggleTerrain3D(e.target.checked));

    const chkEdif3d = document.getElementById("chk-edificios-3d");
    if (chkEdif3d) chkEdif3d.addEventListener("change", (e) => toggleBuildings3D(e.target.checked));

    // 3. Switch de Edificaciones (Master)
    const chkEdifMaster = document.getElementById("chk-edificios");
    if (chkEdifMaster) {
        chkEdifMaster.addEventListener("change", (e) => {
            appState.buildingsMasterVisible = e.target.checked;
            if (!appState.buildingsMasterVisible) {
                map.setLayoutProperty("edificios-fill", "visibility", "none");
                map.setLayoutProperty("edificios-3d", "visibility", "none");
            } else {
                if (appState.buildings3DActive) {
                    map.setLayoutProperty("edificios-3d", "visibility", "visible");
                } else {
                    map.setLayoutProperty("edificios-fill", "visibility", "visible");
                }
            }
        });
    }

    // 4. Switches de Capas 2D
    bindLayerToggle("chk-envolvente", ["envolvente-fill", "envolvente-line"]);
    bindLayerToggle("chk-ruta", ["ruta-line", "ruta-halo"]);
    
    // Switch de Puntos de Referencia (círculos y etiquetas nativas)
    const chkRef = document.getElementById("chk-referencias");
    if (chkRef) {
        chkRef.addEventListener("change", (e) => {
            const isChecked = e.target.checked;
            const vis = isChecked ? "visible" : "none";
            if (map.getLayer("referencias-circles")) {
                map.setLayoutProperty("referencias-circles", "visibility", vis);
            }
            if (map.getLayer("referencias-active-glow")) {
                map.setLayoutProperty("referencias-active-glow", "visibility", vis);
            }
            if (map.getLayer("referencias-active-label")) {
                map.setLayoutProperty("referencias-active-label", "visibility", vis);
            }
            if (map.getLayer("referencias-labels")) {
                map.setLayoutProperty("referencias-labels", "visibility", (isChecked && appState.landmarksLabelsVisible) ? "visible" : "none");
            }
        });
    }

    // 5. Botones de perspectiva de cámara
    const btnCam2D = document.getElementById("btn-cam-2d");
    if (btnCam2D) btnCam2D.addEventListener("click", () => setCameraView("2d"));

    const btnCam3D = document.getElementById("btn-cam-3d");
    if (btnCam3D) btnCam3D.addEventListener("click", () => setCameraView("3d"));

    const btnCamFit = document.getElementById("btn-cam-fit");
    if (btnCamFit) btnCamFit.addEventListener("click", () => setCameraView("fit"));

    // 6. Botón de nombres de hitos
    const btnNames = document.getElementById("btn-toggle-names");
    if (btnNames) btnNames.addEventListener("click", toggleAllLandmarkNames);

    // 7. Botón para colapsar/expandir el panel lateral
    const btnCollapse = document.getElementById("btn-toggle-panel");
    const mainPanel = document.getElementById("main-panel");
    if (btnCollapse && mainPanel) {
        btnCollapse.addEventListener("click", () => {
            mainPanel.classList.toggle("collapsed");
            btnCollapse.innerText = mainPanel.classList.contains("collapsed") ? "+" : "−";
        });
    }

    // 8. Filtro en vivo del buscador de hitos
    const searchInput = document.getElementById("input-search-landmarks");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = appState.landmarksData.filter(feat => {
                const nombre = (feat.properties.nombre || "").toLowerCase();
                const fid = String(feat.properties.fid || "");
                return nombre.includes(query) || fid.includes(query);
            });
            renderLandmarksList(filtered);
        });
    }

    // 9. Controles de Animación de Recorrido e Isovistas
    const btnAnimPlay = document.getElementById("btn-anim-play");
    if (btnAnimPlay) btnAnimPlay.addEventListener("click", togglePlayAnimation);

    const btnAnimStop = document.getElementById("btn-anim-stop");
    if (btnAnimStop) btnAnimStop.addEventListener("click", stopAnimation);

    const btnCamFollow = document.getElementById("btn-anim-cam-follow");
    if (btnCamFollow) btnCamFollow.addEventListener("click", () => toggleCameraFollow());

    const btnCamMode = document.getElementById("btn-anim-cam-mode");
    if (btnCamMode) btnCamMode.addEventListener("click", () => toggleCameraMode());

    // Botones de Velocidad (1x, 2x, 4x)
    document.querySelectorAll(".btn-speed").forEach(btn => {
        btn.addEventListener("click", () => {
            const spd = parseFloat(btn.dataset.speed);
            setAnimationSpeed(spd);
        });
    });

    // Control deslizante de línea de tiempo (Scrubber)
    const animSlider = document.getElementById("anim-slider");
    if (animSlider) {
        animSlider.addEventListener("input", (e) => {
            const fIndex = parseInt(e.target.value, 10);
            if (appState.animPlaying) pauseAnimation();
            renderAnimationFrame(fIndex, true);
        });
        animSlider.addEventListener("change", (e) => {
            const fIndex = parseInt(e.target.value, 10);
            renderAnimationFrame(fIndex, false);
        });
    }

    // Botones para alternar y minimizar la barra flotante de animación
    const btnTogglePlayer = document.getElementById("btn-toggle-anim-player");
    if (btnTogglePlayer) btnTogglePlayer.addEventListener("click", () => toggleAnimationPlayer());

    // Botón flotante minimizado (Pill launcher al centro inferior)
    const btnPillLauncher = document.getElementById("btn-anim-pill-launcher");
    if (btnPillLauncher) btnPillLauncher.addEventListener("click", () => toggleAnimationPlayer(true));

    const btnMinPlayer = document.getElementById("btn-anim-min");
    if (btnMinPlayer) btnMinPlayer.addEventListener("click", () => toggleAnimationPlayer(false));

    // Atajo de teclado: Barra espaciadora para Play / Pausa (si no se está escribiendo en el buscador)
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && document.activeElement !== searchInput) {
            e.preventDefault();
            togglePlayAnimation();
        }
    });
}

/**
 * Función auxiliar para enlazar un checkbox con una o más capas del mapa.
 */
function bindLayerToggle(chkId, layerIds) {
    const chk = document.getElementById(chkId);
    if (!chk) return;
    chk.addEventListener("change", (e) => {
        const vis = e.target.checked ? "visible" : "none";
        layerIds.forEach(id => {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", vis);
            }
        });
    });
}


// ==============================================================================
// 9. BUSCADOR Y LISTA INTERACTIVA DE HITOS URBANOS
// ==============================================================================

/**
 * Renderiza la lista de hitos en el contenedor del panel lateral.
 */
function renderLandmarksList(features) {
    const container = document.getElementById("landmarks-list");
    if (!container) return;

    container.innerHTML = "";

    if (features.length === 0) {
        container.innerHTML = `<div style="padding: 10px; font-size: 11px; color: #94a3b8; text-align: center;">No se encontraron hitos</div>`;
        return;
    }

    features.forEach(feat => {
        const props = feat.properties || {};
        const coords = feat.geometry.coordinates;
        const nombre = props.nombre || "Hito Urbano";
        const fid = props.fid || "";

        const item = document.createElement("div");
        item.className = "landmark-list-item";
        item.dataset.fid = fid;
        if (appState.activeLandmarkFid !== null && String(appState.activeLandmarkFid) === String(fid)) {
            item.classList.add("active");
        }
        item.innerHTML = `
            <span>📍 #${fid} ${nombre}</span>
            <span style="font-size: 10px; opacity: 0.6;">Ver</span>
        `;

        item.addEventListener("click", () => {
            // Volar suavemente hacia el hito y desplegar su popup
            map.flyTo({
                center: coords,
                zoom: 16.5,
                duration: 1200,
                essential: true
            });
            showLandmarkPopup(coords, nombre, fid);
        });

        container.appendChild(item);
    });
}

/**
 * Actualiza los valores de las tarjetas de métricas en la interfaz.
 */
function updateStatsUI(meta, edif) {
    const elRouteLen = document.getElementById("stat-route-len");
    const elBuildingCount = document.getElementById("stat-buildings-count");
    const elLandmarksCount = document.getElementById("stat-landmarks-count");

    if (elRouteLen) elRouteLen.innerText = `${(meta.longitud_ruta_metros / 1000).toFixed(1)} km`;
    if (elBuildingCount) elBuildingCount.innerText = `${edif.features.length.toLocaleString()} edif`;
    if (elLandmarksCount) elLandmarksCount.innerText = `${meta.total_hitos} hitos`;
}


// ==============================================================================
// 10. MOTOR DE ANIMACIÓN DE RECORRIDO E ISOVISTAS EN TIEMPO REAL
// ==============================================================================

/**
 * Prepara los fotogramas, precalcula las geometrías para 60fps y crea el marcador del observador.
 */
function setupAnimation() {
    if (!appState.animData || !appState.animData.frames || !appState.animData.frames.length) {
        console.warn("[Animación] No se encontraron datos de animación.");
        return;
    }

    const total = appState.animData.total_frames || appState.animData.frames.length;
    console.log(`[Animación] Configurando ${total} fotogramas a lo largo de ${appState.animData.longitud_total_m} m...`);

    // Precalcular rumbo suavizado de la cámara (filtro ponderado de 5 cuadros) para giros cinemáticos en esquinas de 90°
    for (let i = 0; i < total; i++) {
        let sinSum = 0, cosSum = 0, wSum = 0;
        for (let offset = -2; offset <= 2; offset++) {
            const idx = Math.max(0, Math.min(total - 1, i + offset));
            const w = 1.0 / (1.0 + Math.abs(offset));
            const rad = (appState.animData.frames[idx].bearing * Math.PI) / 180;
            sinSum += w * Math.sin(rad);
            cosSum += w * Math.cos(rad);
            wSum += w;
        }
        const avgRad = Math.atan2(sinSum, cosSum);
        const smoothDeg = ((avgRad * 180) / Math.PI + 360) % 360;
        appState.animData.frames[i].cam_bearing = Math.round(smoothDeg * 10) / 10;
    }

    // Precalcular array de features GeoJSON para actualización ultra-rápida (0 lag de GC)
    appState.prebuiltFeatures = appState.animData.frames.map((f, i) => ({
        type: "Feature",
        properties: {
            frame: f.frame,
            dist_m: f.dist_m,
            area_m2: f.area_m2,
            area_acum_ha: f.area_acum_ha
        },
        geometry: {
            type: "Polygon",
            coordinates: [f.isovista]
        }
    }));

    // Configurar el slider con los límites máximos
    const slider = document.getElementById("anim-slider");
    if (slider) {
        slider.min = "0";
        slider.max = String(total - 1);
        slider.value = "0";
    }

    const elEnd = document.getElementById("anim-time-end");
    if (elEnd) {
        elEnd.innerText = `${(appState.animData.longitud_total_m / 1000).toFixed(2)} km`;
    }

    // Crear el marcador del observador en la posición inicial (oculto por defecto al inicio)
    const firstFrame = appState.animData.frames[0];
    const elObs = document.createElement("div");
    elObs.className = "observer-marker-container";
    elObs.style.display = "none"; // Se hace visible solo al desplegar los controles
    elObs.innerHTML = `
        <div class="observer-pulse-ring"></div>
        <div class="observer-core-dot"></div>
        <div class="observer-heading-pointer" id="observer-heading-arrow"></div>
    `;

    appState.observerMarker = new maplibregl.Marker({
        element: elObs,
        anchor: "center"
    })
    .setLngLat(firstFrame.coords)
    .addTo(map);

    // Inicializar HUD de telemetría y controles (los polígonos de animación se despliegan al abrir)
    updateAnimationHUD(firstFrame, total);
    updateCamModeUI(false);
}

/**
 * Renderiza el fotograma indicado: actualiza la isovista actual, el rastro acumulado,
 * la posición y orientación del observador, la telemetría HUD y la cámara.
 * En modo 3D, posiciona la cámara DETRÁS del observador mirando hacia el frente del avance.
 */
function renderAnimationFrame(frameIndex, isUserScrubbing = false) {
    if (!appState.animData || !appState.prebuiltFeatures.length) return;
    const total = appState.prebuiltFeatures.length;

    if (frameIndex < 0) frameIndex = 0;
    if (frameIndex >= total) frameIndex = total - 1;

    appState.animCurrentFrame = frameIndex;
    const frame = appState.animData.frames[frameIndex];

    // 1. Actualizar campo visual actual (isovista instantánea en cian brillante)
    if (map.getSource("anim_actual_src")) {
        map.getSource("anim_actual_src").setData(appState.prebuiltFeatures[frameIndex]);
    }

    // 2. Actualizar áreas de isovistas acumuladas (todas las descubiertas desde 0 hasta frameIndex)
    if (map.getSource("anim_acum_src")) {
        map.getSource("anim_acum_src").setData({
            type: "FeatureCollection",
            features: appState.prebuiltFeatures.slice(0, frameIndex + 1)
        });
    }

    // 3. Mover y rotar el marcador del observador
    if (appState.observerMarker) {
        appState.observerMarker.setLngLat(frame.coords);
        updateObserverArrowDirection();
    }

    // 4. Acompañar con la cámara si Seguir Cámara está activo
    if (appState.animCameraFollow && map) {
        const curPitch = map.getPitch();
        const curZoom = map.getZoom();
        // Modo 3D activo si está configurado en animCameraMode, si el mapa está inclinado o si hay capas 3D
        const is3D = appState.animCameraMode === "3d" || curPitch > 15 || appState.buildings3DActive || appState.terrain3DActive;
        const dur = isUserScrubbing ? 0 : Math.max(80, Math.round(150 / appState.animSpeed));

        if (is3D) {
            // ==================================================================
            // MODO 3D: CÁMARA DETRÁS DEL OBSERVADOR (CHASE / PERSPECTIVA PEATONAL)
            // ==================================================================
            // 1. Inclinación 3D (pitch 58° ideal para cañón urbano y cielo)
            const targetPitch = curPitch < 35 ? 58 : curPitch;
            // 2. Zoom adecuado a vista de calle
            const targetZoom = curZoom < 15.2 ? 16.2 : curZoom;
            // 3. Orientación de cámara: rumbo de avance suavizado (cámara posicionada detrás)
            const targetBearing = frame.cam_bearing !== undefined ? frame.cam_bearing : frame.bearing;
            // 4. Desplazamiento sutil hacia abajo para mayor visión hacia adelante
            const offsetY = Math.min(60, Math.round(window.innerHeight * 0.08));

            if (isUserScrubbing) {
                map.jumpTo({
                    center: frame.coords,
                    pitch: targetPitch,
                    bearing: targetBearing,
                    zoom: targetZoom,
                    offset: [0, offsetY]
                });
            } else {
                map.easeTo({
                    center: frame.coords,
                    pitch: targetPitch,
                    bearing: targetBearing,
                    zoom: targetZoom,
                    offset: [0, offsetY],
                    duration: dur,
                    easing: (t) => t
                });
            }
        } else {
            // ==================================================================
            // MODO 2D: VISTA CENITAL ESTÁNDAR (NORTE ARRIBA)
            // ==================================================================
            const targetZoom = curZoom < 15 ? 15.6 : curZoom;
            if (isUserScrubbing) {
                map.jumpTo({
                    center: frame.coords,
                    zoom: targetZoom,
                    offset: [0, 0]
                });
            } else {
                map.easeTo({
                    center: frame.coords,
                    zoom: targetZoom,
                    offset: [0, 0],
                    duration: dur,
                    easing: (t) => t
                });
            }
        }
    }

    // 5. Actualizar telemetría HUD y Scrubber Slider
    updateAnimationHUD(frame, total);
}

/**
 * Actualiza los chips de telemetría y el slider interactivo con los datos del fotograma.
 */
function updateAnimationHUD(frame, total) {
    const elDist = document.getElementById("anim-dist-val");
    if (elDist) elDist.innerText = `${(frame.dist_m / 1000).toFixed(2)} km`;

    const elPct = document.getElementById("anim-pct-val");
    if (elPct) elPct.innerText = `(${frame.pct.toFixed(0)}%)`;

    const elIso = document.getElementById("anim-iso-val");
    if (elIso) elIso.innerText = `${frame.area_m2.toLocaleString()} m²`;

    const elAcum = document.getElementById("anim-acum-val");
    if (elAcum) elAcum.innerText = `${frame.area_acum_ha.toFixed(2)} ha`;

    const elHito = document.getElementById("anim-hito-val");
    if (elHito && frame.hito) {
        elHito.innerText = `${frame.hito.nombre} (a ${frame.hito.dist_m.toFixed(0)} m)`;
    }

    const slider = document.getElementById("anim-slider");
    if (slider && parseInt(slider.value, 10) !== frame.frame) {
        slider.value = String(frame.frame);
    }
}

/**
 * Alterna entre reproducir y pausar la animación.
 */
function togglePlayAnimation() {
    if (appState.animPlaying) {
        pauseAnimation();
    } else {
        startAnimation();
    }
}

/**
 * Inicia el bucle de reproducción continua a lo largo de la ruta.
 */
function startAnimation() {
    if (appState.animPlaying || !appState.animData) return;
    appState.animPlaying = true;
    updatePlayButtonUI(true);

    // Cerrar cualquier popup activo para que no quede rezagado al avanzar la cámara
    if (appState.activePopup) {
        appState.activePopup.remove();
        appState.activePopup = null;
    }

    // Ocultar temporalmente la envolvente estática para disfrutar la revelación progresiva
    if (map.getLayer("envolvente-fill")) {
        map.setLayoutProperty("envolvente-fill", "visibility", "none");
        map.setLayoutProperty("envolvente-line", "visibility", "none");
    }

    // Si ya estábamos en el último fotograma, reiniciar automáticamente desde el principio
    if (appState.animCurrentFrame >= (appState.animData.total_frames - 1)) {
        appState.animCurrentFrame = 0;
        renderAnimationFrame(0, false);
    }

    const baseIntervalMs = 120; // ~8.3 fps a 1x -> ~28 segundos el recorrido completo

    function step() {
        if (!appState.animPlaying) return;

        const next = appState.animCurrentFrame + 1;
        if (next >= appState.animData.total_frames) {
            pauseAnimation();
            renderAnimationFrame(appState.animData.total_frames - 1, false);
            return;
        }

        renderAnimationFrame(next, false);
        const interval = Math.max(30, Math.round(baseIntervalMs / appState.animSpeed));
        appState.animTimer = setTimeout(step, interval);
    }

    const initialInterval = Math.max(30, Math.round(baseIntervalMs / appState.animSpeed));
    appState.animTimer = setTimeout(step, initialInterval);
}

/**
 * Pausa la animación manteniendo la posición actual.
 */
function pauseAnimation() {
    appState.animPlaying = false;
    if (appState.animTimer) {
        clearTimeout(appState.animTimer);
        appState.animTimer = null;
    }
    updatePlayButtonUI(false);
}

/**
 * Detiene la animación y regresa al punto de inicio (Norte).
 */
function stopAnimation() {
    pauseAnimation();
    renderAnimationFrame(0, false);

    // Restaurar visibilidad de la envolvente estática si su checkbox está activo
    const chkEnv = document.getElementById("chk-envolvente");
    if (chkEnv && chkEnv.checked && map.getLayer("envolvente-fill")) {
        map.setLayoutProperty("envolvente-fill", "visibility", "visible");
        map.setLayoutProperty("envolvente-line", "visibility", "visible");
    }
}

/**
 * Actualiza el texto e icono del botón principal de reproducción.
 */
function updatePlayButtonUI(isPlaying) {
    const btn = document.getElementById("btn-anim-play");
    const icon = document.getElementById("anim-play-icon");
    const text = document.getElementById("anim-play-text");

    if (btn) {
        if (isPlaying) {
            btn.classList.add("playing");
            if (icon) icon.innerText = "⏸";
            if (text) text.innerText = "Pausar";
        } else {
            btn.classList.remove("playing");
            if (icon) icon.innerText = "▶";
            if (text) text.innerText = appState.animCurrentFrame > 0 ? "Continuar" : "Iniciar Recorrido";
        }
    }
}

/**
 * Ajusta la velocidad de reproducción de la animación (1x, 2x, 4x).
 */
function setAnimationSpeed(speed) {
    appState.animSpeed = speed;

    document.querySelectorAll(".btn-speed").forEach(btn => {
        if (parseFloat(btn.dataset.speed) === speed) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

/**
 * Alterna el modo de seguimiento automático de la cámara sobre el observador.
 */
function toggleCameraFollow(forceState) {
    if (forceState !== undefined) {
        appState.animCameraFollow = forceState;
    } else {
        appState.animCameraFollow = !appState.animCameraFollow;
    }

    const btn = document.getElementById("btn-anim-cam-follow");
    if (btn) {
        if (appState.animCameraFollow) {
            btn.classList.add("active");
            btn.innerHTML = `<span>🎥</span> Seguir Cámara (On)`;
        } else {
            btn.classList.remove("active");
            btn.innerHTML = `<span>🎥</span> Seguir Cámara (Off)`;
        }
    }
}

/**
 * Muestra u oculta la barra flotante de animación en la pantalla y gestiona la visualización
 * del polígono de inicio y del marcador del observador.
 */
function toggleAnimationPlayer(forceState) {
    if (forceState !== undefined) {
        appState.animPlayerVisible = forceState;
    } else {
        appState.animPlayerVisible = !appState.animPlayerVisible;
    }

    const bar = document.getElementById("anim-player-bar");
    const pill = document.getElementById("btn-anim-pill-launcher");
    const btnSide = document.getElementById("btn-toggle-anim-player");

    if (appState.animPlayerVisible) {
        // 1. Mostrar barra de controles y ocultar botón pill minimizado
        if (bar) bar.classList.remove("hidden");
        if (pill) pill.classList.add("hidden");
        if (btnSide) {
            btnSide.classList.add("active");
            btnSide.innerHTML = `<span>🎬</span> Controles de Animación (Activo)`;
        }

        // 2. Mostrar el marcador del observador
        if (appState.observerMarker) {
            appState.observerMarker.getElement().style.display = "flex";
        }

        // 3. Al desplegar: hacer visible el polígono inicial del que comienza la animación
        renderAnimationFrame(appState.animCurrentFrame, false);

        // 4. Ocultar la envolvente estática para disfrutar la revelación progresiva
        if (map.getLayer("envolvente-fill")) {
            map.setLayoutProperty("envolvente-fill", "visibility", "none");
            map.setLayoutProperty("envolvente-line", "visibility", "none");
        }
    } else {
        // 1. Ocultar barra de controles y mostrar botón pill minimizado
        if (bar) bar.classList.add("hidden");
        if (pill) pill.classList.remove("hidden");
        if (btnSide) {
            btnSide.classList.remove("active");
            btnSide.innerHTML = `<span>🎬</span> Activar Modo Animación`;
        }

        // 2. Si estaba reproduciéndose, pausar
        if (appState.animPlaying) {
            pauseAnimation();
        }

        // 3. Ocultar el marcador del observador
        if (appState.observerMarker) {
            appState.observerMarker.getElement().style.display = "none";
        }

        // 4. Limpiar los polígonos de animación del mapa para restaurar la vista de mapa interactivo normal
        if (map.getSource("anim_actual_src")) {
            map.getSource("anim_actual_src").setData({ type: "FeatureCollection", features: [] });
        }
        if (map.getSource("anim_acum_src")) {
            map.getSource("anim_acum_src").setData({ type: "FeatureCollection", features: [] });
        }

        // 5. Restaurar la envolvente estática si su checkbox está seleccionado
        const chkEnv = document.getElementById("chk-envolvente");
        const envVis = (!chkEnv || chkEnv.checked) ? "visible" : "none";
        if (map.getLayer("envolvente-fill")) {
            map.setLayoutProperty("envolvente-fill", "visibility", envVis);
            map.setLayoutProperty("envolvente-line", "visibility", envVis);
        }
    }
}


// ==============================================================================
// 10. HERRAMIENTAS DE MEDICIÓN INTERACTIVA (DISTANCIA Y ÁREA)
// ==============================================================================

/**
 * Inicializa los escuchadores de eventos para las herramientas de medición.
 */
function setupMeasureTools() {
    // 1. Botones de activación en el panel lateral
    const btnDist = document.getElementById("btn-measure-distance");
    if (btnDist) {
        btnDist.addEventListener("click", () => setMeasureMode("distance"));
    }

    const btnArea = document.getElementById("btn-measure-area");
    if (btnArea) {
        btnArea.addEventListener("click", () => setMeasureMode("area"));
    }

    const btnClear = document.getElementById("btn-measure-clear");
    if (btnClear) {
        btnClear.addEventListener("click", () => clearMeasurement(true));
    }

    // 2. Botones de acción en el HUD flotante
    const btnHudClose = document.getElementById("btn-measure-hud-close");
    if (btnHudClose) {
        btnHudClose.addEventListener("click", () => clearMeasurement(true));
    }

    const btnHudReset = document.getElementById("btn-hud-reset");
    if (btnHudReset) {
        btnHudReset.addEventListener("click", () => clearMeasurement(false));
    }

    const btnHudUndo = document.getElementById("btn-hud-undo");
    if (btnHudUndo) {
        btnHudUndo.addEventListener("click", undoLastMeasurePoint);
    }

    const btnHudFinish = document.getElementById("btn-hud-finish");
    if (btnHudFinish) {
        btnHudFinish.addEventListener("click", finishMeasurement);
    }

    // 3. Atajos de teclado globales
    window.addEventListener("keydown", (e) => {
        if (!appState.measure || !appState.measure.active) return;

        if (e.key === "Escape") {
            e.preventDefault();
            clearMeasurement(true);
        } else if (e.key === "Enter") {
            e.preventDefault();
            finishMeasurement();
        } else if ((e.ctrlKey && (e.key === "z" || e.key === "Z")) || e.key === "Backspace") {
            // Evitar conflicto si el usuario está escribiendo en el buscador de hitos
            if (document.activeElement && document.activeElement.tagName === "INPUT") return;
            e.preventDefault();
            undoLastMeasurePoint();
        }
    });
}

/**
 * Activa, conmuta o desactiva el modo de medición ('distance' o 'area').
 * @param {'distance' | 'area' | null} mode
 */
function setMeasureMode(mode) {
    if (!map) return;

    // Si se presiona el botón del modo actualmente activo, se desactiva
    if (appState.measure.active && appState.measure.mode === mode) {
        clearMeasurement(true);
        return;
    }

    // Limpiar cualquier medición previa antes de iniciar el nuevo modo
    clearMeasurement(false);

    if (!mode) {
        clearMeasurement(true);
        return;
    }

    appState.measure.active = true;
    appState.measure.mode = mode;
    appState.measure.isFinished = false;

    // Desactivar el zoom con doble clic de MapLibre para permitir finalizar con doble clic
    map.doubleClickZoom.disable();

    // Cambiar cursor a cruz de precisión
    document.body.classList.add("measuring-active");
    map.getCanvas().style.cursor = "crosshair";

    // Actualizar botones del panel lateral
    const btnDist = document.getElementById("btn-measure-distance");
    const btnArea = document.getElementById("btn-measure-area");
    const btnClear = document.getElementById("btn-measure-clear");
    if (btnDist) btnDist.classList.toggle("active", mode === "distance");
    if (btnArea) btnArea.classList.toggle("active", mode === "area");
    if (btnClear) btnClear.removeAttribute("disabled");

    // Desplegar HUD superior y tarjeta del panel lateral
    const hud = document.getElementById("measure-hud");
    const hudIcon = document.getElementById("measure-hud-icon");
    const hudTitle = document.getElementById("measure-hud-title");
    const hudStatus = document.getElementById("measure-hud-status");
    const hudInst = document.getElementById("measure-hud-instruction");
    const hudLblPri = document.getElementById("measure-hud-lbl-primary");
    const hudValPri = document.getElementById("measure-hud-val-primary");
    const hudLblSec = document.getElementById("measure-hud-lbl-secondary");
    const hudValSec = document.getElementById("measure-hud-val-secondary");

    const panelCard = document.getElementById("panel-measure-card");
    const panelBadge = document.getElementById("panel-measure-badge");
    const panelStatus = document.getElementById("panel-measure-status");
    const panelPri = document.getElementById("panel-measure-primary");
    const panelSec = document.getElementById("panel-measure-secondary");

    if (hud) hud.classList.remove("hidden");
    if (panelCard) panelCard.classList.remove("hidden");

    if (mode === "distance") {
        if (hudIcon) hudIcon.innerText = "📏";
        if (hudTitle) hudTitle.innerText = "Medición de Distancia";
        if (hudInst) hudInst.innerText = "Haz clic en el mapa para marcar el primer punto del trayecto";
        if (hudLblPri) hudLblPri.innerText = "Distancia Total";
        if (hudValPri) hudValPri.innerText = "0.0 m";
        if (hudLblSec) hudLblSec.innerText = "Tramos y Vértices";
        if (hudValSec) hudValSec.innerText = "0 puntos colocados";

        if (panelBadge) panelBadge.innerText = "📏 Distancia";
        if (panelStatus) panelStatus.innerText = "En curso";
        if (panelPri) panelPri.innerText = "0.0 m";
        if (panelSec) panelSec.innerText = "0 puntos colocados";
    } else {
        if (hudIcon) hudIcon.innerText = "📐";
        if (hudTitle) hudTitle.innerText = "Medición de Área Poligonal";
        if (hudInst) hudInst.innerText = "Haz clic en el mapa para trazar los vértices de la superficie";
        if (hudLblPri) hudLblPri.innerText = "Área Superficial";
        if (hudValPri) hudValPri.innerText = "0.0 m²";
        if (hudLblSec) hudLblSec.innerText = "Perímetro";
        if (hudValSec) hudValSec.innerText = "0.0 m (0 vértices)";

        if (panelBadge) panelBadge.innerText = "📐 Área";
        if (panelStatus) panelStatus.innerText = "En curso";
        if (panelPri) panelPri.innerText = "0.0 m²";
        if (panelSec) panelSec.innerText = "0 vértices colocados";
    }

    if (hudStatus) hudStatus.innerText = "Activo";

    updateMeasureActionButtons();
}

/**
 * Atiende clics en el lienzo del mapa mientras la medición está activa.
 */
function handleMeasureMapClick(e) {
    if (!appState.measure.active) return;

    // Si ya estaba finalizada, un nuevo clic reinicia limpiamente un nuevo trazo
    if (appState.measure.isFinished) {
        clearMeasurement(false);
        appState.measure.active = true;
        appState.measure.isFinished = false;
        map.doubleClickZoom.disable();
    }

    const coord = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];
    const coords = appState.measure.coordinates;
    coords.push(coord);

    // Crear un marcador HTML numérico en el vértice
    const idx = coords.length;
    const markerEl = document.createElement("div");
    markerEl.className = "measure-node-marker";
    markerEl.innerText = String(idx);
    markerEl.title = `Vértice #${idx}`;

    const marker = new maplibregl.Marker({ element: markerEl, anchor: "center" })
        .setLngLat(coord)
        .addTo(map);

    appState.measure.markers.push(marker);

    // Actualizar geometrías en fuentes GeoJSON
    syncMeasureGeoJSON();

    // Actualizar cálculos y HUD
    recalculateMeasureMetrics();
    updateMeasureActionButtons();
}

/**
 * Rastrea el movimiento del cursor para dibujar la guía elástica (rubberband).
 */
let measureMouseMovePending = false;
function handleMeasureMouseMove(e) {
    if (!appState.measure.active || appState.measure.isFinished) return;
    const coords = appState.measure.coordinates;
    if (coords.length === 0) return;

    if (measureMouseMovePending) return;
    measureMouseMovePending = true;

    requestAnimationFrame(() => {
        measureMouseMovePending = false;
        if (!map || !appState.measure.active || appState.measure.isFinished) return;

        const cursorCoord = [e.lngLat.lng, e.lngLat.lat];
        const lastCoord = coords[coords.length - 1];

        // 1. Línea elástica (rubberband)
        const rbFeatures = [];
        if (appState.measure.mode === "distance") {
            rbFeatures.push({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [lastCoord, cursorCoord]
                }
            });
        } else if (appState.measure.mode === "area") {
            // En área, mostramos rubberband desde el último punto al cursor y del cursor al primero
            if (coords.length === 1) {
                rbFeatures.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [lastCoord, cursorCoord]
                    }
                });
            } else {
                rbFeatures.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [lastCoord, cursorCoord, coords[0]]
                    }
                });

                // Previsualización dinámica del polígono en vivo
                const previewPolygon = [...coords, cursorCoord, coords[0]];
                const polySrc = map.getSource("measure_polygon_src");
                if (polySrc) {
                    polySrc.setData({
                        type: "FeatureCollection",
                        features: [{
                            type: "Feature",
                            geometry: {
                                type: "Polygon",
                                coordinates: [previewPolygon]
                            }
                        }]
                    });
                }
            }
        }

        const rbSrc = map.getSource("measure_rubberband_src");
        if (rbSrc) {
            rbSrc.setData({
                type: "FeatureCollection",
                features: rbFeatures
            });
        }

        // 2. Previsualización de métrica en vivo con el cursor
        updateMeasureLivePreview(cursorCoord);
    });
}

/**
 * Calcula y actualiza los indicadores numéricos con la posición tentativa del cursor.
 */
function updateMeasureLivePreview(cursorCoord) {
    const coords = appState.measure.coordinates;
    if (coords.length === 0) return;

    const hudValPri = document.getElementById("measure-hud-val-primary");
    const lastCoord = coords[coords.length - 1];
    const segmentDist = calculateHaversineDistance(lastCoord, cursorCoord);

    if (appState.measure.mode === "distance") {
        const liveTotal = appState.measure.totalDistance + segmentDist;
        if (hudValPri) {
            hudValPri.innerHTML = `${formatDistance(liveTotal)} <span style="font-size:0.75em; opacity:0.75; font-weight:normal;">(+${formatDistance(segmentDist)})</span>`;
        }
    } else if (appState.measure.mode === "area") {
        if (coords.length >= 2) {
            const tempPoly = [...coords, cursorCoord];
            const liveArea = calculateSphericalPolygonArea(tempPoly);
            if (hudValPri) {
                hudValPri.innerText = formatArea(liveArea);
            }
        }
    }
}

/**
 * Finaliza el trazo de la medición actual, fija los valores y coloca una tarjeta flotante de resumen.
 */
function finishMeasurement() {
    if (!appState.measure.active || appState.measure.isFinished) return;
    const coords = appState.measure.coordinates;

    if (appState.measure.mode === "distance" && coords.length < 2) return;
    if (appState.measure.mode === "area" && coords.length < 3) return;

    appState.measure.isFinished = true;

    // Limpiar guía elástica (rubberband)
    const rbSrc = map.getSource("measure_rubberband_src");
    if (rbSrc) {
        rbSrc.setData({ type: "FeatureCollection", features: [] });
    }

    // Sincronizar geometrías definitivas
    syncMeasureGeoJSON();
    recalculateMeasureMetrics();

    // Eliminar marcador de total previo si existía
    if (appState.measure.totalMarker) {
        appState.measure.totalMarker.remove();
        appState.measure.totalMarker = null;
    }

    // Crear marcador flotante con insignia de resultado
    const totalEl = document.createElement("div");
    totalEl.className = "measure-total-badge";

    if (appState.measure.mode === "distance") {
        const lastCoord = coords[coords.length - 1];
        totalEl.innerHTML = `
            <div class="total-title">📏 Distancia Total</div>
            <div class="total-value">${formatDistance(appState.measure.totalDistance)}</div>
            <div class="total-sub">${coords.length} vértices • ${coords.length - 1} tramos</div>
        `;
        appState.measure.totalMarker = new maplibregl.Marker({ element: totalEl, anchor: "bottom", offset: [0, -12] })
            .setLngLat(lastCoord)
            .addTo(map);
    } else {
        // En área, calcular el centroide para ubicar la tarjeta
        let sumLng = 0, sumLat = 0;
        coords.forEach(pt => { sumLng += pt[0]; sumLat += pt[1]; });
        const centroid = [sumLng / coords.length, sumLat / coords.length];

        totalEl.innerHTML = `
            <div class="total-title">📐 Superficie Poligonal</div>
            <div class="total-value">${formatArea(appState.measure.totalArea)}</div>
            <div class="total-sub">Perímetro: ${formatDistance(appState.measure.totalDistance)}</div>
        `;
        appState.measure.totalMarker = new maplibregl.Marker({ element: totalEl, anchor: "center" })
            .setLngLat(centroid)
            .addTo(map);
    }

    // Actualizar textos UI
    const hudStatus = document.getElementById("measure-hud-status");
    const hudInst = document.getElementById("measure-hud-instruction");
    const panelStatus = document.getElementById("panel-measure-status");

    if (hudStatus) hudStatus.innerText = "Completado";
    if (panelStatus) panelStatus.innerText = "Completado";
    if (hudInst) hudInst.innerText = "Medición finalizada. Clic para trazar una nueva o 'Reiniciar' para borrar.";

    updateMeasureActionButtons();
}

/**
 * Deshace el último punto/vértice marcado.
 */
function undoLastMeasurePoint() {
    if (!appState.measure.active || appState.measure.coordinates.length === 0) return;

    if (appState.measure.isFinished) {
        appState.measure.isFinished = false;
        if (appState.measure.totalMarker) {
            appState.measure.totalMarker.remove();
            appState.measure.totalMarker = null;
        }
    }

    appState.measure.coordinates.pop();
    const marker = appState.measure.markers.pop();
    if (marker) marker.remove();

    syncMeasureGeoJSON();
    recalculateMeasureMetrics();
    updateMeasureActionButtons();
}

/**
 * Limpia todas las geometrías de medición y restaura el estado original.
 * @param {boolean} [andDeactivate=false] - Si es true, además apaga la herramienta y oculta el HUD
 */
function clearMeasurement(andDeactivate = false) {
    if (!appState.measure) return;

    // 1. Eliminar marcadores HTML
    appState.measure.markers.forEach(m => m.remove());
    appState.measure.markers = [];

    if (appState.measure.totalMarker) {
        appState.measure.totalMarker.remove();
        appState.measure.totalMarker = null;
    }

    // 2. Limpiar coordenadas y métricas
    appState.measure.coordinates = [];
    appState.measure.isFinished = false;
    appState.measure.totalDistance = 0;
    appState.measure.totalArea = 0;

    // 3. Limpiar capas GeoJSON
    ["measure_polygon_src", "measure_line_src", "measure_rubberband_src", "measure_points_src"].forEach(srcId => {
        if (map && map.getSource(srcId)) {
            map.getSource(srcId).setData({ type: "FeatureCollection", features: [] });
        }
    });

    // 4. Si se desactiva por completo:
    if (andDeactivate) {
        appState.measure.active = false;
        appState.measure.mode = null;

        if (map) {
            map.doubleClickZoom.enable();
            map.getCanvas().style.cursor = "";
        }
        document.body.classList.remove("measuring-active");

        const btnDist = document.getElementById("btn-measure-distance");
        const btnArea = document.getElementById("btn-measure-area");
        const btnClear = document.getElementById("btn-measure-clear");
        if (btnDist) btnDist.classList.remove("active");
        if (btnArea) btnArea.classList.remove("active");
        if (btnClear) btnClear.setAttribute("disabled", "true");

        const hud = document.getElementById("measure-hud");
        const panelCard = document.getElementById("panel-measure-card");
        if (hud) hud.classList.add("hidden");
        if (panelCard) panelCard.classList.add("hidden");
    } else {
        // Solo reiniciar contenido pero manteniendo el modo activo
        recalculateMeasureMetrics();
        updateMeasureActionButtons();
    }
}

/**
 * Sincroniza las fuentes GeoJSON de MapLibre con las coordenadas actuales.
 */
function syncMeasureGeoJSON() {
    if (!map) return;
    const coords = appState.measure.coordinates;

    // 1. Puntos de vértices
    const ptFeatures = coords.map((c, i) => ({
        type: "Feature",
        properties: { index: i + 1 },
        geometry: { type: "Point", coordinates: c }
    }));
    const ptSrc = map.getSource("measure_points_src");
    if (ptSrc) ptSrc.setData({ type: "FeatureCollection", features: ptFeatures });

    // 2. Línea sólida
    const lineSrc = map.getSource("measure_line_src");
    if (lineSrc) {
        if (coords.length >= 2) {
            // Si es área y está finalizado, cerrar la línea alrededor
            const lineCoords = (appState.measure.mode === "area" && appState.measure.isFinished)
                ? [...coords, coords[0]]
                : coords;

            lineSrc.setData({
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: lineCoords }
                }]
            });
        } else {
            lineSrc.setData({ type: "FeatureCollection", features: [] });
        }
    }

    // 3. Polígono de área
    const polySrc = map.getSource("measure_polygon_src");
    if (polySrc) {
        if (appState.measure.mode === "area" && coords.length >= 3) {
            const closed = [...coords, coords[0]];
            polySrc.setData({
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: [closed] }
                }]
            });
        } else {
            polySrc.setData({ type: "FeatureCollection", features: [] });
        }
    }
}

/**
 * Recalcula la distancia o área y actualiza los elementos de texto en pantalla.
 */
function recalculateMeasureMetrics() {
    const coords = appState.measure.coordinates;
    const mode = appState.measure.mode;

    let dist = 0;
    let area = 0;

    if (coords.length >= 2) {
        dist = calculateTotalPathDistance(coords);
        if (mode === "area" && coords.length >= 3) {
            // Sumar el tramo de cierre al perímetro
            dist += calculateHaversineDistance(coords[coords.length - 1], coords[0]);
            area = calculateSphericalPolygonArea(coords);
        }
    }

    appState.measure.totalDistance = dist;
    appState.measure.totalArea = area;

    // Elementos del HUD y Panel
    const hudValPri = document.getElementById("measure-hud-val-primary");
    const hudValSec = document.getElementById("measure-hud-val-secondary");
    const hudInst = document.getElementById("measure-hud-instruction");

    const panelPri = document.getElementById("panel-measure-primary");
    const panelSec = document.getElementById("panel-measure-secondary");

    if (mode === "distance") {
        const textDist = formatDistance(dist);
        const textSec = coords.length === 0
            ? "0 puntos colocados"
            : `${coords.length} puntos • ${Math.max(0, coords.length - 1)} tramos`;

        if (hudValPri) hudValPri.innerText = textDist;
        if (hudValSec) hudValSec.innerText = textSec;
        if (panelPri) panelPri.innerText = textDist;
        if (panelSec) panelSec.innerText = textSec;

        if (!appState.measure.isFinished && hudInst) {
            if (coords.length === 0) {
                hudInst.innerText = "Haz clic en el mapa para marcar el primer punto del trayecto";
            } else if (coords.length === 1) {
                hudInst.innerText = "Haz clic para añadir el siguiente tramo • Doble clic para finalizar";
            } else {
                hudInst.innerText = "Haz clic para añadir más tramos • Doble clic o Enter para finalizar";
            }
        }
    } else {
        const textArea = formatArea(area);
        const textPerim = `${formatDistance(dist)} (${coords.length} vértices)`;

        if (hudValPri) hudValPri.innerText = textArea;
        if (hudValSec) hudValSec.innerText = textPerim;
        if (panelPri) panelPri.innerText = textArea;
        if (panelSec) panelSec.innerText = textPerim;

        if (!appState.measure.isFinished && hudInst) {
            if (coords.length === 0) {
                hudInst.innerText = "Haz clic en el mapa para trazar el primer vértice del polígono";
            } else if (coords.length === 1) {
                hudInst.innerText = "Marca el segundo vértice de la superficie";
            } else if (coords.length === 2) {
                hudInst.innerText = "Marca un tercer vértice para cerrar el polígono y ver el área";
            } else {
                hudInst.innerText = "Haz clic para más vértices • Doble clic o Enter para finalizar";
            }
        }
    }
}

/**
 * Habilita o deshabilita los botones de Finalizar y Deshacer según la cantidad de vértices.
 */
function updateMeasureActionButtons() {
    const coords = appState.measure.coordinates;
    const mode = appState.measure.mode;
    const isFinished = appState.measure.isFinished;

    const btnUndo = document.getElementById("btn-hud-undo");
    const btnFinish = document.getElementById("btn-hud-finish");

    if (btnUndo) {
        btnUndo.disabled = (coords.length === 0);
    }

    if (btnFinish) {
        if (isFinished) {
            btnFinish.disabled = true;
        } else if (mode === "distance") {
            btnFinish.disabled = (coords.length < 2);
        } else if (mode === "area") {
            btnFinish.disabled = (coords.length < 3);
        }
    }
}

// ------------------------------------------------------------------------------
// Fórmulas Geodésicas de Alta Precisión (Haversine & Spherical Excess)
// ------------------------------------------------------------------------------

/**
 * Distancia ortodrómica Haversine entre dos puntos [lng, lat] en metros.
 * @param {[number, number]} p1 - Coordenadas [lng1, lat1]
 * @param {[number, number]} p2 - Coordenadas [lng2, lat2]
 * @returns {number} Distancia en metros
 */
function calculateHaversineDistance(p1, p2) {
    const R = 6371008.8; // Radio medio de la Tierra en metros (WGS-84)
    const toRad = Math.PI / 180;
    const lat1 = p1[1] * toRad;
    const lat2 = p2[1] * toRad;
    const deltaLat = (p2[1] - p1[1]) * toRad;
    const deltaLng = (p2[0] - p1[0]) * toRad;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calcula la distancia acumulada de un arreglo de coordenadas [lng, lat].
 * @param {Array<[number, number]>} coords
 * @returns {number} Distancia total en metros
 */
function calculateTotalPathDistance(coords) {
    if (!coords || coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += calculateHaversineDistance(coords[i], coords[i + 1]);
    }
    return total;
}

/**
 * Calcula el área superficial geodésica de un polígono esférico en metros cuadrados (m²).
 * Emplea el método de exceso esférico de Girard / Gauss-Bonnet.
 * @param {Array<[number, number]>} coords - Anillo de coordenadas [lng, lat]
 * @returns {number} Área en metros cuadrados
 */
function calculateSphericalPolygonArea(coords) {
    if (!coords || coords.length < 3) return 0;
    const R = 6371008.8;
    const toRad = Math.PI / 180;
    let total = 0;
    const n = coords.length;

    for (let i = 0; i < n; i++) {
        const p1 = coords[i];
        const p2 = coords[(i + 1) % n];
        const lam1 = p1[0] * toRad;
        const lam2 = p2[0] * toRad;
        const phi1 = p1[1] * toRad;
        const phi2 = p2[1] * toRad;
        total += (lam2 - lam1) * (2 + Math.sin(phi1) + Math.sin(phi2));
    }

    return Math.abs((total * R * R) / 2.0);
}

/**
 * Formatea una distancia en metros a texto legible (m o km).
 * @param {number} meters
 * @returns {string}
 */
function formatDistance(meters) {
    if (!meters || meters <= 0) return "0.0 m";
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(1)} m`;
}

/**
 * Formatea un área en m² a texto legible (m², ha o km²).
 * @param {number} sqMeters
 * @returns {string}
 */
function formatArea(sqMeters) {
    if (!sqMeters || sqMeters <= 0) return "0.0 m²";
    if (sqMeters >= 1000000) {
        return `${(sqMeters / 1000000).toFixed(2)} km²`;
    }
    if (sqMeters >= 10000) {
        const ha = (sqMeters / 10000).toFixed(2);
        return `${ha} ha (${Math.round(sqMeters).toLocaleString()} m²)`;
    }
    return `${sqMeters.toFixed(1)} m²`;
}


// ==============================================================================
// 11. CONTROL DEL OVERLAY DE CARGA
// ==============================================================================

function updateLoadingText(title, subtext) {
    const elTitle = document.querySelector("#loading-overlay .loading-text");
    const elSub = document.querySelector("#loading-overlay .loading-subtext");
    if (elTitle) elTitle.innerText = title;
    if (elSub) elSub.innerText = subtext;
}

function hideLoadingOverlay() {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
        setTimeout(() => {
            overlay.classList.add("hidden");
        }, 300);
    }
}


// ==============================================================================
// 12. PUNTO DE ENTRADA
// ==============================================================================
window.addEventListener("DOMContentLoaded", () => {
    initMap();
});

