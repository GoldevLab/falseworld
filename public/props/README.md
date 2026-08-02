# Prop models

- **Wardrobe TC** — runtime mesh is `wardrobe_tc_mesh.json` (baked from
  `~/Descargas/wardrobe.glb`). Rebake with a local script if the source GLB
  changes; do not commit the raw 47 MB GLB.
- **Old Chest** — `old_chest_mesh.json` from `~/Descargas/animated_old_chest.glb`
  (NOT_Lonely / Sketchfab, closed pose of `Chest_open`). Used for placeable
  `box_large` / `box_small`. World scrap chests are no longer spawned.
  Rebake: `node tmp/bake-old-chest-node.mjs`
- **Workbenches T1–T3** — `workbench_t1_mesh.json` … `t3` from
  `workbench_level_1.glb`, `workbench_level_2_lod1.glb`,
  `rust_workbench_lvl_3.glb` in Descargas. Do not serve the raw GLBs
  (especially T3 ~40 MB). Rebake: `node tmp/bake-workbenches-node.mjs`
