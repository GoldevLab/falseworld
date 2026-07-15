//! Compact binary chunk wire format (`application/x-falseworld-chunk`).

use crate::{BladePacked, SurfaceChunk, TerrainParams};
use bytemuck::cast_slice;

pub const CONTENT_TYPE: &str = "application/x-falseworld-chunk";
const MAGIC: &[u8; 4] = b"FWCH";
const VERSION: u32 = 1;

pub fn encode_chunk(chunk: &SurfaceChunk) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(
        64 + chunk.heights.len() * 4 + chunk.blades.len() * std::mem::size_of::<BladePacked>(),
    );
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&chunk.seed.to_le_bytes());
    out.extend_from_slice(&chunk.origin_x.to_le_bytes());
    out.extend_from_slice(&chunk.origin_z.to_le_bytes());
    out.extend_from_slice(&chunk.area.to_le_bytes());
    out.extend_from_slice(&chunk.terrain.amplitude.to_le_bytes());
    out.extend_from_slice(&chunk.terrain.frequency.to_le_bytes());
    out.extend_from_slice(&chunk.terrain.seed.to_le_bytes());
    out.extend_from_slice(&chunk.height_res.to_le_bytes());
    let n_h = chunk.heights.len() as u32;
    let n_b = chunk.blades.len() as u32;
    out.extend_from_slice(&n_h.to_le_bytes());
    out.extend_from_slice(&n_b.to_le_bytes());
    for h in &chunk.heights {
        out.extend_from_slice(&h.to_le_bytes());
    }
    out.extend_from_slice(cast_slice(&chunk.blades));
    Ok(out)
}

pub fn decode_chunk(buf: &[u8]) -> Result<SurfaceChunk, String> {
    if buf.len() < 48 || &buf[0..4] != MAGIC {
        return Err("not FWCH".into());
    }
    let mut i = 4;
    let read_u32 = |i: &mut usize| -> Result<u32, String> {
        if *i + 4 > buf.len() {
            return Err("trunc".into());
        }
        let v = u32::from_le_bytes(buf[*i..*i + 4].try_into().unwrap());
        *i += 4;
        Ok(v)
    };
    let read_f32 = |i: &mut usize| -> Result<f32, String> {
        if *i + 4 > buf.len() {
            return Err("trunc".into());
        }
        let v = f32::from_le_bytes(buf[*i..*i + 4].try_into().unwrap());
        *i += 4;
        Ok(v)
    };
    let ver = read_u32(&mut i)?;
    if ver != VERSION {
        return Err(format!("bad version {ver}"));
    }
    let seed = read_u32(&mut i)?;
    let origin_x = read_f32(&mut i)?;
    let origin_z = read_f32(&mut i)?;
    let area = read_f32(&mut i)?;
    let amp = read_f32(&mut i)?;
    let freq = read_f32(&mut i)?;
    let tseed = read_u32(&mut i)?;
    let height_res = read_u32(&mut i)?;
    let n_h = read_u32(&mut i)? as usize;
    let n_b = read_u32(&mut i)? as usize;
    let mut heights = Vec::with_capacity(n_h);
    for _ in 0..n_h {
        heights.push(read_f32(&mut i)?);
    }
    let blade_bytes = n_b * std::mem::size_of::<BladePacked>();
    if i + blade_bytes > buf.len() {
        return Err("trunc blades".into());
    }
    let blades: Vec<BladePacked> = cast_slice(&buf[i..i + blade_bytes]).to_vec();
    Ok(SurfaceChunk {
        seed,
        origin_x,
        origin_z,
        area,
        terrain: TerrainParams {
            amplitude: amp,
            frequency: freq,
            seed: tseed,
        },
        height_res,
        heights,
        blades,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{generate_chunk, ChunkRequest};

    #[test]
    fn roundtrip() {
        let c = generate_chunk(
            &ChunkRequest {
                blades_per_axis: 16,
                height_res: 24,
                ..Default::default()
            },
            &|_| {},
        );
        let b = encode_chunk(&c).unwrap();
        let d = decode_chunk(&b).unwrap();
        assert_eq!(d.blades.len(), c.blades.len());
        assert_eq!(d.heights.len(), c.heights.len());
    }
}
