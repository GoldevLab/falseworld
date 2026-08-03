//! Inventario False World — mochila (24) + hotbar (6), stack 10000.
//! El estado vivo corre en señales Resuma (JSON) + cliente `fw-inventory` (id estable,
//! cache-busted por hash de contenido — ver `resuma::client::client_asset`).
//!
//! `starter_backpack_json` / `starter_hotbar_json` solo sirven de "regalo de
//! bienvenida" renderizado en el SSR mirror; jugadores que ya guardaron una
//! partida reciben su inventario real desde `crate::player_inventory` (fetch
//! async antes de montar la UI — ver `pages/index.rs`).

use serde::{Deserialize, Serialize};

pub const BACKPACK_SLOTS: usize = 24;
pub const HOTBAR_SLOTS: usize = 6;
pub const STACK_SIZE: i32 = 10000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct InvStack {
    pub id: String,
    pub qty: i32,
}

#[derive(Clone, Copy, Debug)]
#[allow(dead_code)]
pub struct ItemDef {
    pub id: &'static str,
    pub label: &'static str,
    pub stack_size: i32,
    /// hotbar tool kinds: gather | build | placeable | tool | resource | consumable
    pub kind: &'static str,
}

#[allow(dead_code)]
pub const ITEMS: &[ItemDef] = &[
    ItemDef { id: "wood", label: "Madera", stack_size: STACK_SIZE, kind: "resource" },
    ItemDef { id: "stone", label: "Piedra", stack_size: STACK_SIZE, kind: "resource" },
    ItemDef { id: "metal", label: "Metal", stack_size: STACK_SIZE, kind: "resource" },
    ItemDef { id: "sulfur", label: "Azufre", stack_size: STACK_SIZE, kind: "resource" },
    ItemDef { id: "hq", label: "HQM", stack_size: STACK_SIZE, kind: "resource" },
    ItemDef { id: "scrap", label: "Chatarra", stack_size: STACK_SIZE, kind: "resource" },
    ItemDef { id: "rock_tool", label: "Pico", stack_size: 1, kind: "gather" },
    ItemDef { id: "hatchet_tool", label: "Hacha", stack_size: 1, kind: "gather" },
    ItemDef { id: "build_plan", label: "Plano", stack_size: 1, kind: "build" },
    ItemDef { id: "hammer_tool", label: "Martillo", stack_size: 1, kind: "tool" },
    ItemDef { id: "key_lock", label: "Cerradura", stack_size: 10, kind: "placeable" },
    ItemDef { id: "tool_cupboard_item", label: "Armario", stack_size: 5, kind: "placeable" },
    ItemDef { id: "workbench_1", label: "Mesa T1", stack_size: 5, kind: "placeable" },
    ItemDef { id: "workbench_2", label: "Mesa T2", stack_size: 5, kind: "placeable" },
    ItemDef { id: "workbench_3", label: "Mesa T3", stack_size: 5, kind: "placeable" },
    ItemDef { id: "metal_door", label: "Puerta metal", stack_size: 5, kind: "placeable" },
    ItemDef { id: "satchel", label: "Satchel", stack_size: 10, kind: "consumable" },
    ItemDef { id: "rocket", label: "Cohete", stack_size: 5, kind: "consumable" },
    ItemDef { id: "c4", label: "C4", stack_size: 5, kind: "consumable" },
    ItemDef { id: "research_table", label: "Mesa investigación", stack_size: 5, kind: "placeable" },
    ItemDef { id: "cloth", label: "Tela", stack_size: STACK_SIZE, kind: "resource" },
    ItemDef { id: "food", label: "Comida", stack_size: STACK_SIZE, kind: "consumable" },
    ItemDef { id: "sleeping_bag", label: "Saco dormir", stack_size: 5, kind: "placeable" },
    ItemDef { id: "campfire", label: "Fogata", stack_size: 5, kind: "placeable" },
    ItemDef { id: "box_small", label: "Caja pequeña", stack_size: 5, kind: "placeable" },
    ItemDef { id: "box_large", label: "Caja grande", stack_size: 5, kind: "placeable" },
];

pub fn item_def(id: &str) -> Option<&'static ItemDef> {
    ITEMS.iter().find(|i| i.id == id)
}

pub fn empty_slots_json(n: usize) -> String {
    let nulls = std::iter::repeat("null")
        .take(n)
        .collect::<Vec<_>>()
        .join(",");
    format!("[{}]", nulls)
}

/// Hotbar: Hacha · Pico · Plano · Martillo · Armario · Cerradura.
pub fn starter_hotbar_json() -> String {
    serde_json::to_string(&[
        Some(InvStack { id: "hatchet_tool".into(), qty: 1 }),
        Some(InvStack { id: "rock_tool".into(), qty: 1 }),
        Some(InvStack { id: "build_plan".into(), qty: 1 }),
        Some(InvStack { id: "hammer_tool".into(), qty: 1 }),
        Some(InvStack { id: "tool_cupboard_item".into(), qty: 5 }),
        Some(InvStack { id: "key_lock".into(), qty: 10 }),
    ])
    .unwrap_or_else(|_| empty_slots_json(HOTBAR_SLOTS))
}

/// Debug stash: 10k de cada material + stacks máximos de objetos del juego.
pub fn starter_backpack_json() -> String {
    serde_json::to_string(&[
        Some(InvStack { id: "wood".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "stone".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "metal".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "sulfur".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "hq".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "scrap".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "cloth".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "food".into(), qty: STACK_SIZE }),
        Some(InvStack { id: "satchel".into(), qty: 10 }),
        Some(InvStack { id: "rocket".into(), qty: 5 }),
        Some(InvStack { id: "c4".into(), qty: 5 }),
        Some(InvStack { id: "workbench_1".into(), qty: 5 }),
        Some(InvStack { id: "workbench_2".into(), qty: 5 }),
        Some(InvStack { id: "workbench_3".into(), qty: 5 }),
        Some(InvStack { id: "metal_door".into(), qty: 5 }),
        Some(InvStack { id: "research_table".into(), qty: 5 }),
        Some(InvStack { id: "sleeping_bag".into(), qty: 5 }),
        Some(InvStack { id: "campfire".into(), qty: 5 }),
        Some(InvStack { id: "box_small".into(), qty: 5 }),
        Some(InvStack { id: "box_large".into(), qty: 5 }),
        None,
        None,
        None,
        None,
    ])
    .unwrap_or_else(|_| empty_slots_json(BACKPACK_SLOTS))
}
