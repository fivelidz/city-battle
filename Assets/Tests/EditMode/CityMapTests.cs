// CITY BATTLE -- CityMapLoader tests: prove the canonical citymap JSON parses into the game's
// float[,] heightfield (with the correct row-major -> [x,z] transpose), buildings, and water level.
// Uses a tiny inline map so it needs no external files; a second test opts in if the real Sydney
// citymap is present in StreamingAssets.
using System.IO;
using NUnit.Framework;
using UnityEngine;
using CityBattle.Terrain;

namespace CityBattle.Tests
{
    public class CityMapTests
    {
        // A 3x3 map. heights are row-major heights[z*res + x]. We pick values that make the
        // transpose observable: value = x*10 + z, so heights[x,z] must equal x*10 + z.
        const string TinyMap =
            "{\"city\":\"testville\",\"display\":\"Testville\"," +
            "\"bbox\":[0,0,1,1],\"origin_lonlat\":[0,0],\"size_m\":[200,200]," +
            "\"terrain\":{\"res\":3,\"cell_m\":100,\"min_m\":0,\"max_m\":22," +
            "\"heights\":[0,10,20, 1,11,21, 2,12,22]}," +   // z=0 row: x=0,1,2 -> 0,10,20 ; etc
            "\"water_level_m\":5," +
            "\"buildings\":[{\"poly\":[[10,10],[30,10],[30,30],[10,30]],\"h\":40,\"base_m\":12}]}";

        [Test]
        public void Parse_TinyMap_ReadsScalars()
        {
            var d = CityMapLoader.Parse(TinyMap);
            Assert.IsNotNull(d, "map should parse");
            Assert.AreEqual("testville", d.City);
            Assert.AreEqual(3, d.Res);
            Assert.That(d.CellM, Is.EqualTo(100f).Within(0.01f));
            Assert.That(d.MaxM, Is.EqualTo(22f).Within(0.01f));
            Assert.That(d.WaterLevelM, Is.EqualTo(5f).Within(0.01f));
            Assert.That(d.WidthM, Is.EqualTo(200f).Within(0.01f));
        }

        [Test]
        public void Parse_Heights_TransposedRowMajorToXZ()
        {
            var d = CityMapLoader.Parse(TinyMap);
            Assert.IsNotNull(d.Heights);
            Assert.AreEqual(3, d.Heights.GetLength(0));
            Assert.AreEqual(3, d.Heights.GetLength(1));
            // heights[x,z] should equal x*10 + z given our encoding.
            for (int x = 0; x < 3; x++)
                for (int z = 0; z < 3; z++)
                    Assert.That(d.Heights[x, z], Is.EqualTo(x * 10 + z).Within(0.001f),
                        $"heights[{x},{z}] mismatch (row-major transpose wrong)");
        }

        [Test]
        public void Parse_Buildings_PolyHeightBase()
        {
            var d = CityMapLoader.Parse(TinyMap);
            Assert.AreEqual(1, d.Buildings.Count);
            var b = d.Buildings[0];
            Assert.AreEqual(4, b.Poly.Length);
            Assert.That(b.HeightM, Is.EqualTo(40f).Within(0.01f));
            Assert.That(b.BaseM, Is.EqualTo(12f).Within(0.01f));
            Assert.That(b.Poly[1].x, Is.EqualTo(30f).Within(0.01f));
            Assert.That(b.Poly[2].y, Is.EqualTo(30f).Within(0.01f)); // z stored in Vector2.y
        }

        [Test]
        public void ToTerrainField_HeightAndWaterCorrect()
        {
            var d = CityMapLoader.Parse(TinyMap);
            var field = d.ToTerrainField(Vector3.zero);
            // Sample the exact grid node (x=2,z=1) at world (200,100): expect 2*10+1 = 21.
            float h = field.HeightAt(200f, 100f);
            Assert.That(h, Is.EqualTo(21f).Within(0.01f));
            // Water level should be origin.y + water_level_m = 5.
            Assert.That(field.WaterLevelM, Is.EqualTo(5f).Within(0.01f));
            Assert.IsTrue(field.IsWater(0f, 0f), "corner height 0 < water 5 => water");
            Assert.IsFalse(field.IsWater(200f, 200f), "corner height 22 > water 5 => dry");
        }

        [Test]
        public void RealSydneyCityMap_LoadsIfPresent()
        {
            string path = Path.Combine(Application.streamingAssetsPath,
                                       "CityMaps/sydney_harbour.citymap.json");
            if (!File.Exists(path))
                Assert.Ignore("Sydney citymap not present in StreamingAssets; skipping real-file test.");

            var d = CityMapLoader.LoadFromFile(path);
            Assert.IsNotNull(d, "real Sydney citymap should parse");
            Assert.Greater(d.Res, 32, "expected a real-sized grid");
            Assert.AreEqual(d.Res * 1L, d.Heights.GetLength(0) * 1L);
            Assert.Greater(d.Buildings.Count, 100, "Sydney harbour should have many buildings");
            Assert.Greater(d.MaxM, 50f, "Sydney has real relief (>50m)");
        }
    }
}
