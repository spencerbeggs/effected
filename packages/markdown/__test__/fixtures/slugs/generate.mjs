import fs from "node:fs";
import Slugger, { slug } from "github-slugger";
const inputs = ["Hello World","a & b","foo_bar"," spaced ","emoji 🎉 here","é","Café","C++ & C#","Über uns","What's new?","a  b","a-b","2nd ¼ ²","日本語 見出し","Ⓐ circled","1. Intro","`code` span","","---","Ünï cödé","tab\there","MiXeD CaSe"];
const sequences = [["dup","dup","dup-1","dup"],["a","a","a"],["a-1","a","a"],["x & y","x  y","x & y"],["","",""]];
const out = {
  slugs: inputs.map((input) => ({ input, slug: slug(input) })),
  sequences: sequences.map((inputs) => { const s = new Slugger(); return { inputs, slugs: inputs.map((i) => s.slug(i)) }; }),
};
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, "\t") + "\n");
