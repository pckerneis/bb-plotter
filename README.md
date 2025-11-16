# Bytebeat plotter

Bytebeat plotter is a web-based Bytebeat expression player with plotting capabilities.

It features a CodeMirror-based editor and real-time visualisation widgets.

Example:

```js
a=plot(t>>10&7),
a*t
```

The value of `a` gets plotted in a plot widget.

Try it live at [https://pckerneis.github.io/bb-plotter/](https://pckerneis.github.io/bytebeat-plotter/).

## Getting started

This project is a frontend-only app built with [Vite](https://vite.dev/) and TypeScript.

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

Then open the URL printed in the terminal (by default `http://localhost:5173/`).

### Build for production

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```
