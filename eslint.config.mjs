import {defineConfig,globalIgnores} from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([...nextVitals,...nextTs,globalIgnores(['.next/**','prototype/**','.local/**','next-env.d.ts']),{rules:{'@next/next/no-img-element':'off','@next/next/no-html-link-for-pages':'off','react-hooks/set-state-in-effect':'off','react-hooks/refs':'off'}}]);
