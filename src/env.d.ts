declare module '*.css?inline' {
  const css: string;
  export default css;
}

/** The extension API; undefined when the script runs outside the extension. */
declare const chrome: any;
