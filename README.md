# NetArchitect

**Offline-First IPv4 Subnet Calculator, VLSM Allocator, Network Planner & Security Auditor**

NetArchitect is an offline-first mobile and web application built for network engineers, sysadmins, DevOps practitioners, and students. It provides bitwise-accurate IPv4 calculations, recursive Variable Length Subnet Masking (VLSM), static security auditing against RFC standards, and multi-vendor infrastructure configuration export—with zero external network requests.

---

## Key Features

- **Strict Offline-First Privacy:** Zero network calls, no telemetry, no tracking, and no third-party cloud dependencies. All network plans and learning progress are stored locally on your device in SQLite.
- **High-Performance Bitwise IP Engine:** All IPv4 mathematics are executed with unsigned 32-bit bitwise operations (`>>> 0`), providing instant sub-millisecond calculation across addresses, netmasks, wildcards, and broadcast ranges.
- **VLSM Tree Allocator:** Automatically solves optimal subnet allocations for arbitrary host requirements using power-of-two prefix fitting and binary buddy merging/splitting.
- **Per-Subnet Host Allocation:** Generates deterministic IP allocations for gateways, static infrastructure blocks, and dynamic DHCP pools.
- **Static Security Auditor:** Performs offline security audits on network designs to flag unsegmented VLANs, overlapping subnets, public address leakage, perimeter bogons (RFC 1918), and legacy /30 point-to-point waste (RFC 3021).
- **Multi-Vendor Configuration Exporter:** Exports complete network plans into ready-to-deploy configurations for:
  - **Cisco IOS** (Interface configurations, sub-interfaces, 802.1Q encapsulation)
  - **MikroTik RouterOS** (`/ip address`, `/ip pool`, `/ip dhcp-server`)
  - **Terraform HCL** (`aws_vpc`, `aws_subnet`, `cidrsubnet` annotations)
  - **Linux** (`/etc/network/interfaces` and Netplan YAML)
  - **JSON & Markdown** tabular documentation
- **Auxiliary Network Utilities:**
  - **Route Summarizer / Supernetting:** Aggregates multiple CIDR blocks into minimal supernets, reporting route efficiency and detecting unadvertised routing "holes".
  - **Binary Subnet Splitter:** Visual binary tree splitter allowing recursive division and buddy merging of IP blocks.
- **Networking Curriculum & Quiz Engine:** Interactive lessons and dynamically generated quizzes covering subnetting theory, binary math, RFC 1918 bogons, and point-to-point links.
- **Adaptive Theme System:** Fully responsive light and dark themes using NativeWind v4 and custom semantic design tokens with accessible WCAG AA contrast.

---

## Tech Stack

- **Framework:** [Expo](https://expo.dev/) (SDK 57) with [Expo Router](https://docs.expo.dev/router/introduction/)
- **Runtime:** [React Native](https://reactnative.dev/) (0.86) & React 19
- **Language:** [TypeScript](https://www.typescriptlang.org/) (Strict mode, `noEmit`, `exactOptionalPropertyTypes`)
- **Styling:** [NativeWind v4](https://www.nativewind.dev/) & [Tailwind CSS v3](https://tailwindcss.com/)
- **Icons:** [Lucide React Native](https://lucide.dev/) with `cssInterop` theme adaptation
- **Local Database:** [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) (Native SQLite on iOS/Android, `wa-sqlite` WebAssembly fallback on Web)
- **State Management:** [Zustand](https://github.com/pmndrs/zustand) with AsyncStorage persistence
- **Testing:** [Vitest](https://vitest.dev/) with 1,250+ unit tests across all calculation engines

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/Lance0519/NetArchitect.git
cd NetArchitect

# Install dependencies
npm install
```

### Running the Application

```bash
# Start Expo development server
npm start

# Run on Web in your browser
npm run web

# Run on Android emulator / connected device
npm run android

# Run on iOS simulator (macOS required)
npm run ios
```

---

## Quality & Verification Gates

NetArchitect enforces strict quality gates on every commit:

```bash
# Run all unit tests (1,250+ tests)
npm test

# Type checking with strict TypeScript compiler
npm run typecheck

# Code linting with ESLint
npm run lint

# Check class order and verify stylesheet compilation
npm run check
```

---

## License

Copyright (c) 2026 Justine Lance Martin (Lance0519). All Rights Reserved.

This software is proprietary. Unauthorized copying, distribution, modification, or commercial use is strictly prohibited. See the [LICENSE](LICENSE) file for terms.
