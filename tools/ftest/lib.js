const __FCROOT = require("path").resolve(__dirname, "..", "..");
const fs=require('fs');
const SRC=fs.readFileSync(__FCROOT + '/src/App.jsx','utf8');
// slice from a start marker to a stop marker (exclusive), assert uniqueness
function slice(startMarker, stopMarker){
  const a=SRC.indexOf(startMarker);
  if(a<0) throw new Error('marker not found: '+startMarker);
  if(SRC.indexOf(startMarker, a+1)>=0) throw new Error('marker NOT UNIQUE: '+startMarker);
  const b=SRC.indexOf(stopMarker, a+startMarker.length);
  if(b<0) throw new Error('stop marker not found: '+stopMarker);
  return SRC.slice(a,b);
}
function build(code, exportNames){
  return new Function(code+'\nreturn {'+exportNames.join(',')+'};')();
}
module.exports={SRC,slice,build};
