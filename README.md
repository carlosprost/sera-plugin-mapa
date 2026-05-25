# 🗺️ Localizador Geográfico para SERA

Este plugin oficial de **SERA** te permite georreferenciar la ubicación de tus registros en un mapa interactivo sin salir de la aplicación, priorizando la privacidad de tus datos.

---

## 🚀 Características
- **Enlaces a OpenStreetMap:** Detecta automáticamente las columnas de coordenadas (`coordenadas`, `coord`, `gps`, `lat_lng`, `ubicacion`) y transforma sus valores de celda en enlaces directos y estéticos a OpenStreetMap.
- **Mapa de Registros Unificado:** Añade un botón en la barra superior (Ribbon) que barre toda la tabla actual y abre una ventana modal interactiva con un **mapa embebido** de OpenStreetMap.
- **Panel de Registros Interactivo:** Una lista lateral dentro del mapa unificado te permite navegar entre las locaciones y centrar el mapa al hacer un solo click.
- **Privacidad Absoluta:** No utiliza APIs de terceros con trackers comerciales. Es 100% libre e independiente.

---

## 🛠️ Estructura del Código
- `manifest.json`: Metadatos e icono del plugin.
- `dist/index.js`: IIFE que inicializa la API `window.SeraAPI`, implementa el detector de coordenadas, el cell renderer y el modal del mapa interactivo.
- `dist/style.css`: Estilos visuales de los badges y del modal traslúcido.

---

## 📜 Licencia
Este plugin está liberado bajo la licencia **MIT** de código abierto para libre distribución y modificación por la comunidad.
