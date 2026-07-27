const {slice,build}=require('./lib.js');
const M=build(slice('const _PREP = "fresh|','function pickForSlot('),
  ['_ingKey','prettyIngredient','splitIngredientNames','dedupeGrocery','repairGroceryQty','grocerySection','_pkgPhrase']);
let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
const K=M._ingKey;

// 1. real-world collapse groups from his actual list
for(const g of [
  ['Celery','Celery hearts','finely chopped celery'],
  ['orange juice','or 2 Tablespoons orange juice'],
  ['chicken breast',"organic chicken breast (because it's healthy!)",'boneless skinless chicken breasts'],
  ['pepper','freshly ground pepper'],
  ['egg white','Egg whites','Liquid egg whites'],
  ['tomato','tomatoes'],['berry','berries'],
  ['lemon','lemon juice','lemon zest'],
  ['mozzarella','mozzarella cheese'],
  ['protein powder','protein powder (hemp'],
]){ const k=[...new Set(g.map(K))]; ok(k.length===1,'collapse '+JSON.stringify(g)+' -> '+JSON.stringify(k)); }

// 2. must stay apart
for(const [a,b] of [['black beans','green beans'],['white pepper','black pepper'],['brown rice','jasmine rice'],
  ['whole milk','almond milk'],['red onion','onion'],['egg','eggplant'],['chicken breast','chicken thigh'],
  ['bell pepper','pepper']])
  ok(K(a)!==K(b),'must stay apart: '+a+' vs '+b+' (both "'+K(a)+'")');

// 3. whey family collapses at the dedupe stage even though keys differ
const wheyRows=[{item:'whey',qty:'1 scoop'},{item:'Vanilla whey',qty:'2 scoops'},{item:'Vanilla whey protein',qty:'1 tub'}];
const wheyOut=M.dedupeGrocery(wheyRows,K);
ok(wheyOut.length===1,'whey family -> 1 row, got '+wheyOut.length+' '+JSON.stringify(wheyOut.map(r=>r.item)));

// 4. package math
const uses=[{amt:'2',servings:1}];
ok(/dozen/i.test(M._pkgPhrase('Eggs',uses)),'eggs -> dozen, got '+M._pkgPhrase('Eggs',uses));
for(const n of ['Egg noodles','Egg roll wrappers','Eggplant'])
  ok(!/dozen/i.test(M._pkgPhrase(n,uses)),n+' must NOT be dozen, got '+M._pkgPhrase(n,uses));

// 5. compound splitting
for(const [raw,n] of [['Bell pepper & onion',2],['Cucumber & tomato',2],['Garlic powder, salt, pepper',3],['Carrot & celery',2],['Salt & pepper',2]]){
  const p=M.splitIngredientNames(raw); ok(p.length===n,'split "'+raw+'" -> want '+n+', got '+JSON.stringify(p)); }
ok(M.splitIngredientNames('Salt, pepper, to taste').every(p=>!/to taste/i.test(p)),'leading non-ingredient fragment dropped');
ok(K(M.splitIngredientNames('Salt & pepper to taste')[1])===K('pepper'),'trailing to-taste residue normalises to the standalone key');
// every split part shares the key of its standalone line
ok(M.splitIngredientNames('Bell pepper & onion').map(K).includes(K('onion')),'split part shares standalone key');

// 6. display names keep product words, drop instructions
for(const [raw,want] of [['finely chopped celery','celery'],['part-skim mozzarella','part-skim'],['shredded chicken','shredded']]){
  const got=M.prettyIngredient(raw).toLowerCase();
  ok(got.includes(want),'prettyIngredient("'+raw+'") -> "'+got+'" should contain "'+want+'"'); }

// 7. stored-list self-heal, checkmark preserved
const stored=[{item:'Egg white',qty:'2',section:'Protein & dairy'},
 {item:'Egg whites',qty:'4 large',section:'Protein & dairy',checked:true},
 {item:'Liquid egg whites',qty:'1 carton',section:'Protein & dairy'},
 {item:'Egg noodles',qty:'1 dozen',section:'Pantry'},
 {item:'Eggs',qty:'1 dozen',section:'Protein & dairy'}];
const healed=M.dedupeGrocery(stored,K);
ok(healed.length===3,'stored 5 rows -> 3, got '+healed.length+' '+JSON.stringify(healed.map(x=>x.item)));
ok(healed.some(x=>x.checked===true),'checkmark preserved through merge');
const rep=M.repairGroceryQty(healed,K,M._pkgPhrase);
ok(!rep.some(x=>/noodle/i.test(x.item)&&/dozen/i.test(x.qty)),'egg noodles dozen repaired');
ok(rep.some(x=>K(x.item)==='egg'&&/dozen/i.test(x.qty)),'real eggs keep their dozen');

// 8. aisles
for(const [n,s] of [['chicken breast','Protein & dairy'],['spinach','Produce'],['jasmine rice','Pantry'],['frozen berries','Frozen']])
  ok(M.grocerySection(n)===s,'aisle '+n+' -> want '+s+', got '+M.grocerySection(n));

console.log('\nGROCERY: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
