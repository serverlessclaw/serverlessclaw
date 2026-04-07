# Dashboard Theme System

> **Navigation**: [← Index Hub](../INDEX.md) | [Architecture ↗](../ARCHITECTURE.md)

ClawCenter supports a fully adaptive **Dark / Light / System** theme system. The UI preserves its core "cyber" aesthetic while ensuring accessibility and readability across all lighting environments.

## Technical Architecture

The theme system is built on **Tailwind CSS v4**'s `@theme` directive, semantic CSS variables, and the `next-themes` provider.

```text
[ User Preference ] -> [ ThemeProvider ] -> [ <html class="dark"> / "" ]
                                     |
                                     v
[ globals.css ] ----> [ CSS Variable Definitions ]
       |                     (:root vs .dark)
       |                            |
       v                            v
[ Tailwind @theme ] <--- [ Utility Class Mapping ]
       |                 (bg-background, text-foreground)
       |                            |
       +----------------------------+
                                    |
                                    v
                          [ React Components ]
```

## Core Variables

We avoid hardcoded hex codes in components. Instead, use these semantic variables:

| Variable | Tailwind Class | Light Value | Dark Value |
| :--- | :--- | :--- | :--- |
| `--background` | `bg-background` | `#ffffff` | `#0a0a0a` |
| `--foreground` | `text-foreground` | `#0a0a0a` | `#ededed` |
| `--cyber-green` | `text-cyber-green` | `#00bf7a` (Darker) | `#00ffa3` (Vibrant) |
| `--card-bg` | `bg-card` | `rgba(0,0,0,0.03)` | `rgba(255,255,255,0.03)` |
| `--card-border` | `border-border` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.1)` |

## Best Practices

### 1. Avoid Hardcoded Colors
**❌ Anti-pattern:**
```tsx
<div className="bg-[#0a0a0a] text-white">
```

**✅ Preferred:**
```tsx
<div className="bg-background text-foreground">
```

### 2. Relative Opacity
For subtle borders or backgrounds, use Tailwind's color opacity modifier with the foreground variable:
```tsx
<div className="border-foreground/10 bg-foreground/5">
```
This ensures the transparency is relative to the current theme's text color.

### 3. Cyber Glows
For neon "glow" effects, use `color-mix` or specific variables that adapt. In `globals.css`, we provide a darker variant of Green/Blue for light mode to ensure accessible contrast.

```tsx
<div className="shadow-[0_0_20px_color-mix(in_srgb,var(--cyber-green)_40%,transparent)]">
```

## Verification

After making UI changes, run the test suite to ensure no regressions in component styling:
```bash
cd dashboard
pnpm test-silent
```
