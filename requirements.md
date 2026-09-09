# AgriSense — Requirements Specification

**Project:** AgriSense — Crop Disease Detection & Market Price Advisory Platform  
**Author:** [Fasan]  
**Degree:** BSc (Hons) in Information & Communication Technology

---

## 1. Problem Statement

Smallholder farmers in Sri Lanka face two recurring problems:

1. **Late disease detection.** Crop diseases are often identified only after
   visible spread, by which point yield loss is significant. Access to
   agricultural extension officers is limited, and a single officer may serve
   several thousand farmers.

2. **Price opacity.** Farmers have little visibility into current or expected
   market prices, and therefore sell at whatever price is offered at the point
   of collection.

Both problems are worsened by poor mobile connectivity in rural farming areas,
which makes conventional always-online applications unusable in the field.

---

## 2. Project Objectives

| ID    | Objective                                                                            |
| ----- | ------------------------------------------------------------------------------------ |
| OBJ-1 | Build a mobile-first PWA that remains fully functional without internet connectivity |
| OBJ-2 | Detect crop leaf diseases from photographs using a CNN with ≥90% test accuracy       |
| OBJ-3 | Provide visual explanations (Grad-CAM) for every diagnosis                           |
| OBJ-4 | Forecast market prices 7–14 days ahead with confidence intervals                     |
| OBJ-5 | Detect regional disease outbreaks and notify affected farmers automatically          |
| OBJ-6 | Support Tamil, Sinhala, and English throughout the interface                         |

---

## 3. Scope

### 3.1 In Scope

- Farmer registration (phone + OTP), plot registry with GPS boundaries
- Crop calendar with growth-stage tracking and task reminders
- Leaf disease detection for [N] crops and [M] disease classes
- Grad-CAM explanations and confidence-threshold human fallback
- Market price display and 7/14-day forecasting
- Officer dashboard: outbreak heatmap, scan verification, advisory broadcast
- Full offline operation with automatic background synchronisation
- Trilingual interface (Tamil / Sinhala / English)

### 3.2 Out of Scope

- Payment processing or e-commerce (no buying/selling within the app)
- Direct integration with government agricultural databases
- Native iOS/Android applications (PWA only)
- Soil testing, weather forecasting (consumed via third-party API only)
- Livestock or fisheries
- Real-time video consultation with officers

### 3.3 Assumptions

- Farmers have access to an Android smartphone with a camera
- Intermittent (not permanent) internet connectivity is available
- Historical market price data is obtainable from public sources
- Agricultural officers will act as domain validators

---

## 4. Actors

| Actor                | Description                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Farmer               | Primary user. Registers plots, scans leaves, views prices, receives alerts                         |
| Agricultural Officer | Monitors district-level disease activity, verifies low-confidence diagnoses, broadcasts advisories |
| Market Administrator | Enters and verifies daily market price data                                                        |
| System Administrator | Manages master data, users, and monitors model performance                                         |

---

## 5. User Stories

Priority uses MoSCoW: **Must** / **Should** / **Could**.

### 5.1 Authentication & Profile

#### US-01 — Phone-based login · Must

> As a farmer, I want to register and log in using my phone number and an OTP,
> so that I don't have to remember a password.

**Acceptance criteria**

- [ ] Entering a valid phone number sends a 6-digit OTP
- [ ] OTP expires after 5 minutes
- [ ] Account is locked for 15 minutes after 3 failed attempts
- [ ] Maximum 3 OTP requests per hour per number

---

#### US-02 — Language selection · Must

> As a farmer, I want to choose my preferred language (Tamil, Sinhala, or English),
> so that I can use the app comfortably in my own language.

**Acceptance criteria**

- [ ] Language is selected during first login
- [ ] Language can be changed at any time from the profile screen
- [ ] All UI text, disease names, and treatment instructions appear in the chosen language
- [ ] Language preference persists while offline

---

<!--
மீதி stories-ஐ இதே format-ல தொடருங்க: US-03 முதல் US-24 வரை.
நேத்து கொடுத்த list-ல இருந்து copy பண்ணி இங்க paste பண்ணுங்க.
-->

---

## 6. Non-Functional Requirements

| ID     | Category        | Requirement                                                                                     |
| ------ | --------------- | ----------------------------------------------------------------------------------------------- |
| NFR-01 | Performance     | Disease prediction returns within 10 seconds on a 3G connection                                 |
| NFR-02 | Performance     | App shell loads within 3 seconds on a mid-range Android device                                  |
| NFR-03 | Availability    | Core features (scan capture, plot view, cached prices) work fully offline                       |
| NFR-04 | Reliability     | Queued offline mutations sync exactly once; no duplicates on retry                              |
| NFR-05 | Security        | Passwords absent by design; JWT access tokens expire in 15 minutes with rotating refresh tokens |
| NFR-06 | Security        | Officers can access data only within their assigned district                                    |
| NFR-07 | Usability       | All interactive elements have a minimum touch target of 44×44 px                                |
| NFR-08 | Usability       | Lighthouse PWA score ≥ 90, Accessibility score ≥ 90                                             |
| NFR-09 | Scalability     | ML inference runs as an independently scalable service                                          |
| NFR-10 | Maintainability | Backend unit test coverage ≥ 60%                                                                |
| NFR-11 | Data            | Uploaded images are compressed client-side to under 500 KB                                      |
| NFR-12 | Privacy         | Exact plot coordinates are fuzzed in any publicly visible heatmap                               |

---

## 7. Constraints

| Type           | Constraint                                                                |
| -------------- | ------------------------------------------------------------------------- |
| Time           | 12 weeks (single developer)                                               |
| Data           | No proprietary Sri Lankan leaf disease dataset; PlantVillage used as base |
| Data           | Historical price data limited to publicly available sources               |
| Infrastructure | Free-tier hosting only                                                    |
| Domain         | No access to certified agronomists for treatment validation               |

---

## 8. Risks

| ID   | Risk                                                                            | Impact | Mitigation                                                                  |
| ---- | ------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| R-01 | Model accuracy on real field photos lower than on PlantVillage (lab conditions) | High   | Aggressive augmentation; confidence thresholding; officer verification loop |
| R-02 | Offline sync conflicts cause data loss                                          | High   | Idempotent client IDs; entity-specific conflict rules; extensive testing    |
| R-03 | Insufficient historical price data for forecasting                              | Medium | Reduce to fewer crops/markets; document as limitation                       |
| R-04 | Scope creep beyond 12 weeks                                                     | Medium | Priority-ordered cut list defined in advance                                |
| R-05 | Free-tier hosting cold starts degrade demo                                      | Low    | Warm-up ping before demonstration                                           |

---

## 9. Success Criteria

The project is considered successful if:

- [ ] Disease classification achieves ≥90% test accuracy across all classes
- [ ] Price forecasting outperforms a naive baseline on MAPE
- [ ] The application performs a full scan → queue → sync cycle with no data loss while offline
- [ ] Outbreak detection correctly clusters seeded test scenarios
- [ ] The system is deployed and publicly accessible
- [ ] All Must-priority user stories are implemented

---

## 10. Glossary

| Term        | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| PWA         | Progressive Web App — a website installable and usable like a native app                             |
| Grad-CAM    | Gradient-weighted Class Activation Mapping — highlights image regions influencing a CNN's prediction |
| PHI         | Pre-Harvest Interval — mandatory waiting period between pesticide application and harvest            |
| MAPE        | Mean Absolute Percentage Error — forecast accuracy metric                                            |
| DS Division | Divisional Secretariat — Sri Lankan administrative unit below district                               |
| Idempotency | Property where repeating an operation produces the same result as performing it once                 |

---

## 11. Revision History

| Version | Date       | Changes               |
| ------- | ---------- | --------------------- |
| 1.0     | 2026-09-09 | Initial specification |
