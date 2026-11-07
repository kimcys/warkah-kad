// Lets a test import a source file as text: `import src from "../../src/x.js?raw"` (vite handles the suffix).
declare module "*?raw" {
  const text: string;
  export default text;
}
