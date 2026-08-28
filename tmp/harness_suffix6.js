
async function __runFullRegen() {
  const tree = await listCollectionTree();
  const selection = {};
  for (const entry of tree) {
    selection[entry.name] = entry.groups;
  }
  const result = await generateSelected(selection);
  return { result, collections: tree.map((t) => ({ name: t.name, groupCount: t.groups.length })) };
}
return await __runFullRegen();
