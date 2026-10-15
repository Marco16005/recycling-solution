const ESTILO_MAPA_POR_OMISION = "https://tiles.openfreemap.org/styles/liberty";

/** Estilo del mapa configurable en el servidor (MAPA_ESTILO_URL). */
export const estiloMapaUrl = () => process.env.MAPA_ESTILO_URL || ESTILO_MAPA_POR_OMISION;
