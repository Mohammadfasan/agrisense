<div align="center">

# 🌾 AgriSense

**Offline-first crop disease detection and market price advisory platform for smallholder farmers**

[![Live Demo](https://img.shields.io/badge/demo-live-success)](https://agrisense.vercel.app)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-6-47A248?logo=mongodb&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.11-009688?logo=fastapi&logoColor=white)
![TensorFlow](https://img.shields.io/badge/TensorFlow-2.15-FF6F00?logo=tensorflow&logoColor=white)

[Live Demo](https://agrisense.vercel.app) · [Demo Video](https://youtu.be/xxxx) · [API Docs](https://api.agrisense.app/docs) · [Architecture](docs/architecture.md)

</div>

---

## Overview

Smallholder farmers in Sri Lanka identify crop diseases late and sell produce
without price visibility. Both problems are made worse by unreliable mobile
coverage in rural farming areas, which makes conventional always-online
applications unusable in the field.

AgriSense addresses this with a **fully offline-capable progressive web app**
backed by a **CNN-based disease classifier**, **time-series price forecasting**,
and **spatio-temporal outbreak detection**.

<p align="center">
  <img src="docs/assets/demo.gif" width="720" alt="AgriSense demo" />
</p>

---

## Key Features

| | Feature | Detail |
|---|---|---|
| 📴 | **Full offline operation** | Scan, log activity, and browse data with no connection. Queued mutations sync automatically via Background Sync with idempotent, conflict-resolved delivery |
| 🔬 | **Disease detection** | MobileNetV2 transfer learning across 15 classes at 94% test accuracy |
| 🔍 | **Explainable predictions** | Grad-CAM heatmaps show which leaf regions drove the diagnosis |
| ⚠️ | **Confidence-aware fallback** | Below-threshold predictions are escalated to an agricultural officer instead of guessing |
| 📈 | **Price forecasting** | 7/14-day forecasts with confidence intervals; Prophet + LSTM ensemble at 8.2% MAPE |
| 🗺️ | **Outbreak detection** | DBSCAN spatio-temporal clustering triggers automated regional advisories |
| 🌐 | **Trilingual** | Tamil, Sinhala, and English across UI and domain content |

---

## Architecture
