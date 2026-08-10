# Humanoid Robotics Factory Floor Control Panel Design

## Design Overview

This document outlines the design for a modern control panel for a humanoid robotics factory floor, designed for the VS Code Pencil editor.

## Structure

### Main Container
- **Size**: 900px × 700px
- **Position**: Centered at (100, 100)
- **Background**: White with subtle shadow
- **Border Radius**: 20px
- **Border**: 3px solid #3b82f6 (blue accent)
- **Box Shadow**: 0 15px 40px rgba(59, 130, 246, 0.25)

### Title
- **Text**: "Factory Floor Control Center"
- **Font Size**: 36px
- **Font Weight**: Bold
- **Color**: #1e3a8a (blue-900)
- **Text Shadow**: 2px 2px 8px rgba(0,0,0,0.15)
- **Position**: Centered at top

## Sections

### 1. Control Buttons Section
- **Position**: (150, 100)
- **Size**: 600px × 200px
- **Background**: White
- **Border Radius**: 15px
- **Padding**: 25px
- **Display**: Flex column with 20px gap

#### Buttons
1. **START ROBOT**
   - Size: 200px × 60px
   - Background: #10b981 (green-500)
   - Color: White
   - Border Radius: 10px
   - Font Weight: Bold
   - Font Size: 18px
   - Box Shadow: 0 6px 12px rgba(16, 185, 129, 0.3)
   - Cursor: Pointer
   - Transition: All 0.3s ease

2. **STOP ROBOT**
   - Size: 200px × 60px
   - Background: #ef4444 (red-500)
   - Color: White
   - Border Radius: 10px
   - Font Weight: Bold
   - Font Size: 18px
   - Box Shadow: 0 6px 12px rgba(239, 68, 68, 0.3)
   - Cursor: Pointer
   - Transition: All 0.3s ease

3. **PAUSE**
   - Size: 200px × 60px
   - Background: #3b82f6 (blue-500)
   - Color: White
   - Border Radius: 10px
   - Font Weight: Bold
   - Font Size: 18px
   - Box Shadow: 0 6px 12px rgba(59, 130, 246, 0.3)
   - Cursor: Pointer
   - Transition: All 0.3s ease

### 2. Status Indicators Section
- **Position**: (150, 320)
- **Size**: 600px × 180px
- **Background**: White
- **Border Radius**: 15px
- **Padding**: 25px
- **Display**: Flex with 25px gap

#### Status Items
1. **Status: Ready** - #10b981 (green-500)
2. **Battery: 85%** - #3b82f6 (blue-500)
3. **Position: (0,0,0)** - #9ca3af (gray-400)
4. **Temperature: 22°C** - #f59e0b (amber-500)

### 3. Robot Visualization Section
- **Position**: (150, 520)
- **Size**: 600px × 180px
- **Background**: White
- **Border Radius**: 15px
- **Padding**: 25px
- **Display**: Flex with 25px gap

#### Elements
1. **Robot Icon/Image**
   - Size: 160px × 160px
   - Border Radius: 10px
   - Border: 2px solid #e0e0e0
   - Source placeholder: `https://placehold.co/160x160/4ade80/white?text=🤖`

2. **Robot Information**
   - Model: Humanoid R2 (Bold, 16px, #1e3a8a)
   - Active: Online (Green, #10b981)
   - CPU: 42% | Memory: 1.2GB (Gray, #6b7280)

### 4. Technical Information Panel
- **Position**: (730, 320)
- **Size**: 180px × 250px
- **Background**: White
- **Border Radius**: 15px
- **Padding**: 20px
- **Display**: Flex column with 15px gap

#### Parameters
1. **Version: 2.1.0** - Blue (#3b82f6)
2. **Serial: D-2024-001** - Green (#10b981)
3. **Firmware: v3.5** - Amber (#f59e0b)
4. **Last Update: 2024-08-09** - Gray (#6b7280)
5. **IP Address: 192.168.1.45** - Purple (#8b5cf6)
6. **Port: 8080** - Pink (#ec4899)

### 5. Connection Status Bar
- **Position**: (150, 720)
- **Size**: 600px × 60px
- **Background**: White
- **Border Radius**: 12px
- **Padding**: 20px
- **Display**: Flex with justifyContent: space-between

#### Elements
1. **🔗 Connection Icon** (Green #10b981, 24px)
2. **Connection: Online** (Blue #1e3a8a, 16px)
3. **Current Timestamp** (Gray #6b7280, 14px)

## Background Grid
- **Style**: Solid grid/dashed lines
- **Opacity**: 0.5
- **Pointer Events**: None (background layer)

## Color Palette

| Purpose | Color | Hex | Description |
|---------|-------|-----|-------------|
| Primary | Blue-900 | #1e3a8a | Title text, important labels |
| Secondary | Gray-400 | #9ca3af | Disabled/neutral text |
| Success | Green-500 | #10b981 | Ready, Online, Success states |
| Warning | Amber-500 | #f59e0b | Temperature, Caution |
| Error | Red-500 | #ef4444 | Stop, Error states |
| Action | Blue-500 | #3b82f6 | Pause, Interactive elements |
| Background | White | #ffffff | Panel backgrounds |
| Border | Gray-200 | #e0e0e0 | Panel borders |

## Typography
- **Title**: 36px, Bold, Centered
- **Labels**: 14-16px, Semi-bold for titles
- **Body**: 12-14px, Regular
- **Status values**: 14px, Bold

## Spacing Guidelines
- **Container Padding**: 20-25px
- **Section Gap**: 20-25px between elements
- **Button Size**: 60px height for good touch targets
- **Border Radius**: 10-20px for modern look

## Interaction States
All buttons have:
- Hover transition effects
- Smooth animations (0.3s ease)
- Visual feedback on interaction

## Grid Layout
Uses a background grid (dashed) to help align elements:
- Spacing: 20px grid units
- Helps maintain consistent spacing
- Not visible in final design (opacity: 0.5)

## Implementation Notes for Pencil Editor

When implementing in the Pencil editor:

1. **Clear Canvas**: First call `editor.clear()` to remove existing nodes
2. **Layer Order**: Background grid should be last (background layer)
3. **Container Hierarchy**: Use `appendChild()` to nest elements
4. **Responsive Considerations**: Design uses fixed pixel dimensions suitable for control panels
5. **Accessibility**: Ensure color contrast ratios meet WCAG standards
6. **Visual Hierarchy**: Use size, color, and position to guide user attention

## Next Steps

1. Create the .pen file with this design
2. Export to HTML/Tailwind for web implementation
3. Export components as React/Vue elements for reuse
4. Add interactive states (hover, active, disabled)