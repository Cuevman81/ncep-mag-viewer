# NCEP Model Guidance (MAG) Viewer

An interactive, high-performance web dashboard for visualizing NCEP Model Guidance (MAG) meteorological charts. Designed for meteorologists who need fast, seamless access to forecast imagery across multiple atmospheric levels and forecast hours.

![Model guidance grid with the GFS 500 mb chart at +48 h](docs/screenshot.png)

*Hover over a cell in the grid to show that chart; here, the GFS 500 mb chart at +48 h.*

## 🚀 Key Features

- **Interactive Hover Grid**: Navigate through hundreds of forecast hours and multiple pressure levels just by moving your mouse. No clicking required.
- **Smart Profile Mode**: Automatically resolves the most scientifically relevant product for each level (e.g., MSLP/Wind at surface, Vorticity at 500mb, Jets at 300mb).
- **Run Progress Monitoring**: Real-time background scanning of NCEP servers to detect exactly how far the current model run has progressed, including a "Smart Freshness" check to prevent viewing yesterday's stale data.
- **Keyboard Navigation**: Use arrow keys to explore the atmosphere and time-steps with precision.
- **Current NCEP Models**: GFS, AIGFS, RRFS, HRRR, RAP, and GEFS Mean/Spread (see the table below).
- **Regional Sectors**: RRFS and HRRR can be viewed on MAG's six US regional sectors (Southeast, South Central, Northeast, North Central, Northwest, Southwest) as well as CONUS.
- **Cross-Level Consistency**: Synchronized viewing allows you to maintain the same forecast hour while switching between atmospheric parameters.
- **Frame Density**: Thin long runs to 3-, 6- or 12-hourly columns so they fit without horizontal scrolling.

## 🌐 Models

| Model | Type | Cycles (UTC) | Forecast range | Regions |
|---|---|---|---|---|
| GFS | Global | 00/06/12/18 | 384 h (3-hourly to 240 h, 12-hourly after) | NAMER, CONUS |
| AIGFS | Global, AI-based (NOAA's Artificial Intelligence GFS) | 00/06/12/18 | 384 h, 6-hourly | NAMER, CONUS |
| RRFS | Regional, convection-allowing (replaced NAM) | 00/06/12/18 | 84 h, hourly | CONUS + 6 US sectors |
| HRRR | Regional, convection-allowing | Hourly | 48 h at 00/06/12/18Z, 18 h otherwise | CONUS + 6 US sectors |
| RAP | Regional | Hourly | 51 h at 03/09/15/21Z, 21 h otherwise | CONUS, NAMER |
| GEFS Mean/Spread | Global ensemble | 00/06/12/18 | 384 h (6-hourly to 180 h, 12-hourly after) | NAMER, CONUS |

Precipitation uses the accumulation period each model publishes on MAG at that hour: 1 h for HRRR, RAP and RRFS; 3 h for GFS (12 h past 240 h); 6 h for AIGFS and GEFS.

### Model changes

- **November 2026 (MAG 7.1.0)**: NWS retired the **NAM** and **SREF** (SCN 26-47), and MAG stopped serving them. **RRFS** replaces the NAM in this viewer; anyone whose last-used model was NAM now opens on RRFS. SREF's replacement, **REFS**, is on MAG, but it only publishes ensemble probability fields, with no pressure-level charts for the level-by-hour grid, so it isn't included here.
- **August 2026 (MAG 7.0.0)**: MAG added the **AIGFS**, which this viewer added in November 2026.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism UI), and Modern JavaScript.
- **Data Source**: Live imagery via NOAA/NCEP Model Analyses and Guidance (MAG).
- **Zero Dependencies**: Pure client-side application—no backend or external libraries required.

## 🌍 Live Demo

Access the interactive dashboard here:  
**[https://cuevman81.github.io/ncep-mag-viewer/](https://cuevman81.github.io/ncep-mag-viewer/)**

## 👨‍🔬 Developed By

**Rodney Cuevas**, Meteorologist  
*Mississippi Department of Environmental Quality*  
[RCuevas@mdeq.ms.gov](mailto:RCuevas@mdeq.ms.gov)

## ⚖️ License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*Data provided courtesy of NOAA/NCEP. This tool is not an official NOAA product.*
