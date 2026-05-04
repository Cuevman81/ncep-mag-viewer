# NCEP Model Guidance (MAG) Viewer

An interactive, high-performance web dashboard for visualizing NCEP Model Guidance (MAG) meteorological charts. Designed for meteorologists who need fast, seamless access to forecast imagery across multiple atmospheric levels and forecast hours.

## 🚀 Key Features

- **Interactive Hover Grid**: Navigate through hundreds of forecast hours and multiple pressure levels just by moving your mouse. No clicking required.
- **Smart Profile Mode**: Automatically resolves the most scientifically relevant product for each level (e.g., MSLP/Wind at surface, Vorticity at 500mb, Jets at 300mb).
- **Run Progress Monitoring**: Real-time background scanning of NCEP servers to detect exactly how far the current model run has progressed, including a "Smart Freshness" check to prevent viewing yesterday's stale data.
- **Keyboard Navigation**: Use arrow keys to explore the atmosphere and time-steps with precision.
- **Deep Model Support**: Full support for GFS, NAM, HRRR, RAP, SREF, and GEFS Mean/Spread.
- **Cross-Level Consistency**: Synchronized viewing allows you to maintain the same forecast hour while switching between atmospheric parameters.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism UI), and Modern JavaScript.
- **Data Source**: Live imagery via NOAA/NCEP Model Analyses and Guidance (MAG).
- **Zero Dependencies**: Pure client-side application—no backend or external libraries required.

## 🌍 Live Demo

Once deployed to GitHub Pages, you can access the viewer at:  
`https://<your-username>.github.io/ncep-mag-viewer/`

## 👨‍🔬 Developed By

**Rodney Cuevas**, Meteorologist  
*Mississippi Department of Environmental Quality*  
[RCuevas@mdeq.ms.gov](mailto:RCuevas@mdeq.ms.gov)

## ⚖️ License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*Data provided courtesy of NOAA/NCEP. This tool is not an official NOAA product.*
