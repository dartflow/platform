declare module 'edmonds-blossom' {
  /** Maximum-weight matching; true requires maximum cardinality before weight. */
  export default function blossom(edges:[number,number,number][],maxCardinality?:boolean):number[];
}
