// Minimal ambient declarations for WeChat mini program globals.
// (Full typings would come from the `miniprogram-api-typings` package; we keep
// this self-contained so the miniprogram needs no separate npm install.)
declare const wx: any;
declare function App(options: any): void;
declare function Page(options: any): void;
declare function getApp(): any;
declare function Component(options: any): void;
declare function getCurrentPages(): any[];
