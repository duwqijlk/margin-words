declare module "hyphen" {
  function createHyphenator(
    patterns: unknown,
    options?: { minWordLength?: number },
  ): (word: string) => string;
  export default createHyphenator;
}

declare module "hyphen/patterns/en-us.js" {
  const patterns: unknown;
  export default patterns;
}
