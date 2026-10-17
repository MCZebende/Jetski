/* Catálogo lido em 16/10/2026 em
   https://www.marinha.mil.br/chm/dados-do-segnav/cartas-raster
   Os hrefs apontam para os arquivos da DHN. O app não hospeda as cartas.
   ref é o porto citado no título, só para ordenar a lista. Não é o limite da folha. */
const Charts = (() => {
  const list = [
    {
      id: "1620",
      title: "Do Pontal de Sernambetiba à Ilha Grande",
      date: "14/09/2026",
      aviso: "2026-99",
      kapSize: "949 KB",
      tifSize: "39,7 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1620_2.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1620geotiff_2.zip",
      ref: { lat: -23.05, lon: -44.20 }
    },
    {
      id: "1625",
      title: "Enseadas da Ilha Grande",
      date: "25/02/2025",
      aviso: "2024-306",
      kapSize: "700 KB",
      tifSize: "23,5 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1625_0.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1625geotiff.zip",
      ref: { lat: -23.136, lon: -44.169 }
    },
    {
      id: "1631",
      title: "Baía da Ilha Grande — parte central",
      date: "25/08/2026",
      aviso: "2026-89",
      kapSize: "1,44 MB",
      tifSize: "21,5 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1631_2.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1631geotiff_2.zip",
      ref: { lat: -23.10, lon: -44.22 }
    },
    {
      id: "1632",
      title: "Baía da Ilha Grande — parte centro norte",
      date: "25/08/2026",
      aviso: "2026-89",
      kapSize: "2,06 MB",
      tifSize: "30,2 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1632_2.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1632geotiff_2.zip",
      ref: { lat: -23.05, lon: -44.20 }
    },
    {
      id: "1633",
      title: "Baía da Ilha Grande — parte oeste",
      date: "16/04/2026",
      aviso: "2026-24",
      kapSize: "2,43 MB",
      tifSize: "34,6 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1633_0.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1633geotiff_1.zip",
      ref: { lat: -23.12, lon: -44.35 }
    },
    {
      id: "1636",
      title: "Porto de Angra dos Reis e proximidades",
      date: "25/08/2026",
      aviso: "2026-89",
      kapSize: "999 KB",
      tifSize: "17,3 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1636_1.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1636geotiff_1.zip",
      ref: { lat: -23.007, lon: -44.318 }
    },
    {
      id: "1640",
      title: "Proximidades do porto de São Sebastião",
      date: "14/09/2026",
      aviso: "2026-99",
      kapSize: "844 KB",
      tifSize: "20,4 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1640_2.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1640geotiff_2.zip",
      ref: { lat: -23.802, lon: -45.403 }
    },
    {
      id: "1643",
      title: "Canal de São Sebastião (parte norte)",
      date: "23/09/2025",
      aviso: "2025-50",
      kapSize: "886 KB",
      tifSize: "13,0 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1643.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1643geotiff.zip",
      ref: { lat: -23.76, lon: -45.41 }
    },
    {
      id: "1644",
      title: "Canal de São Sebastião (parte sul)",
      date: "23/09/2025",
      aviso: "2025-50",
      kapSize: "909 KB",
      tifSize: "13,2 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1644.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1644geotiff.zip",
      ref: { lat: -23.86, lon: -45.41 }
    },
    {
      id: "1711",
      title: "Proximidades do porto de Santos",
      date: "14/09/2026",
      aviso: "2026-99",
      kapSize: "1,43 MB",
      tifSize: "45,7 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1711_2.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1711geotiff_2.zip",
      ref: { lat: -24.01, lon: -46.32 }
    },
    {
      id: "1712",
      title: "Porto de Santos (parte norte)",
      date: "23/09/2026",
      aviso: "2026-105",
      kapSize: "1,07 MB",
      tifSize: "17,7 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1712_3.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1712geotiff_4.zip",
      ref: { lat: -23.95, lon: -46.31 }
    },
    {
      id: "1713",
      title: "Porto de Santos (parte sul)",
      date: "12/05/2026",
      aviso: "2026-34",
      kapSize: "796 KB",
      tifSize: "8,2 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/1713_2.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/1713geotiff_2.zip",
      ref: { lat: -23.99, lon: -46.30 }
    },
    {
      id: "23100",
      title: "Do Rio de Janeiro a Santos",
      date: "14/09/2026",
      aviso: "2026-99",
      kapSize: "1,48 MB",
      tifSize: "44,3 MB",
      kap: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/raster/23100_1.zip",
      tif: "https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/geotiff/23100geotiff_1.zip",
      ref: { lat: -23.50, lon: -44.90 },
      overview: true
    }
  ];

  function withDistance(pos) {
    return list
      .filter((chart) => !chart.overview)
      .map((chart) => ({
        chart,
        nm: pos ? Geo.haversine(pos, chart.ref) / 1852 : null
      }))
      .sort((a, b) => (a.nm == null ? 0 : a.nm) - (b.nm == null ? 0 : b.nm));
  }

  function suggest(pos, limitNm = 40) {
    if (!pos) return [];
    return withDistance(pos).filter((item) => item.nm <= limitNm);
  }

  function nearest(pos, count = 3) {
    return withDistance(pos).slice(0, count);
  }

  return {
    catalog: "https://www.marinha.mil.br/chm/dados-do-segnav/cartas-raster",
    list,
    suggest,
    nearest
  };
})();
