// CITY BATTLE — Scenario: playable level setups. A scenario defines the two forces, their start
// positions, objective flags, and a win condition — the seed for "level examples" to try out.
// Scenarios are data-light (build from chassis/gun names + positions) so they work in the slice
// scene and, later, against a real city map.
using System;
using System.Collections.Generic;
using UnityEngine;
using CityBattle.Data;
using CityBattle.Units;

namespace CityBattle.Combat
{
    public enum WinCondition { Eliminate, HoldFlag, Escort, DestroyTarget }

    [Serializable]
    public class ScenarioUnit
    {
        public string name;
        public int team;
        public string chassisName;
        public string gunName;
        public Vector3 pos;
        public bool flagship;
        public bool amphibious;
    }

    [Serializable]
    public class ScenarioFlag
    {
        public string label;
        public Vector3 pos;
        public int team;
        public FlagKind kind = FlagKind.Move;
    }

    public class Scenario
    {
        public string Id;
        public string Title;
        public string Brief;
        public WinCondition Win = WinCondition.Eliminate;
        public readonly List<ScenarioUnit> Units = new();
        public readonly List<ScenarioFlag> Flags = new();

        // ---- The built-in example levels ----
        public static readonly List<Func<Scenario>> Examples = new()
        {
            HarbourCrossing, RidgeDefence, ConvoyEscort
        };

        public static Scenario ById(string id)
        {
            foreach (var make in Examples) { var s = make(); if (s.Id == id) return s; }
            return HarbourCrossing();
        }

        // L1: amphibious assault — cross the water and take the far objective.
        public static Scenario HarbourCrossing()
        {
            var s = new Scenario { Id = "harbour_crossing", Title = "Harbour Crossing",
                Brief = "Amphibious assault. Ford the water, seize OBJECTIVE ALPHA on the far shore, " +
                        "and clear the defenders. Your Leviathan flagship anchors the comms net.",
                Win = WinCondition.HoldFlag };
            s.Units.Add(new ScenarioUnit { name = "FLAG-01 LEVIATHAN", team = 0, chassisName = "Leviathan",
                gunName = "SG-203 Heavy Siege", pos = new Vector3(700, 0, 300), flagship = true, amphibious = true });
            s.Units.Add(new ScenarioUnit { name = "ANZAC-02 HOPLITE", team = 0, chassisName = "Hoplite",
                gunName = "BR-155 Battle Gun", pos = new Vector3(950, 0, 320), amphibious = true });
            s.Units.Add(new ScenarioUnit { name = "ANZAC-03 JACKAL", team = 0, chassisName = "Jackal",
                gunName = "FT-76 Field Gun", pos = new Vector3(500, 0, 280), amphibious = true });
            s.Units.Add(new ScenarioUnit { name = "ENEMY-01 PHALANX", team = 1, chassisName = "Phalanx",
                gunName = "HW-105 Howitzer", pos = new Vector3(800, 0, 1900) });
            s.Units.Add(new ScenarioUnit { name = "ENEMY-02 HOPLITE", team = 1, chassisName = "Hoplite",
                gunName = "BR-155 Battle Gun", pos = new Vector3(1100, 0, 1850) });
            s.Flags.Add(new ScenarioFlag { label = "OBJECTIVE ALPHA", pos = new Vector3(900, 0, 1800), team = 0, kind = FlagKind.Hold });
            return s;
        }

        // L2: ridge defence — hold the high ground against an attacking force.
        public static Scenario RidgeDefence()
        {
            var s = new Scenario { Id = "ridge_defence", Title = "Ridge Defence",
                Brief = "Hold the ridge. Position hull-down on the crest; let the enemy come into your " +
                        "immunity band. Use indirect fire on anything in defilade below.",
                Win = WinCondition.Eliminate };
            s.Units.Add(new ScenarioUnit { name = "FLAG-01 BASTION", team = 0, chassisName = "Bastion",
                gunName = "SG-203 Heavy Siege", pos = new Vector3(1200, 0, 1150), flagship = true });
            s.Units.Add(new ScenarioUnit { name = "ANZAC-02 PHALANX", team = 0, chassisName = "Phalanx",
                gunName = "BR-155 Battle Gun", pos = new Vector3(1000, 0, 1130) });
            s.Units.Add(new ScenarioUnit { name = "ANZAC-03 HOPLITE", team = 0, chassisName = "Hoplite",
                gunName = "GM-122 Gun-Mortar", pos = new Vector3(1400, 0, 1130) });
            for (int i = 0; i < 4; i++)
                s.Units.Add(new ScenarioUnit { name = $"RED-{i+1} JACKAL", team = 1, chassisName = "Jackal",
                    gunName = "FT-76 Field Gun", pos = new Vector3(700 + i * 300, 0, 300) });
            s.Flags.Add(new ScenarioFlag { label = "HOLD THE CREST", pos = new Vector3(1200, 0, 1180), team = 0, kind = FlagKind.Hold });
            return s;
        }

        // L3: convoy escort — protect a slow convoy crab to the exit flag.
        public static Scenario ConvoyEscort()
        {
            var s = new Scenario { Id = "convoy_escort", Title = "Convoy Escort",
                Brief = "Escort the convoy crab to EXIT. Keep it in the comms net and screen it from " +
                        "the raiders that will try to flank.",
                Win = WinCondition.Escort };
            s.Units.Add(new ScenarioUnit { name = "CONVOY-01", team = 0, chassisName = "Carrier-Crab Nimbus",
                gunName = "HW-105 Howitzer", pos = new Vector3(400, 0, 400) });
            s.Units.Add(new ScenarioUnit { name = "FLAG-ESCORT LEVIATHAN", team = 0, chassisName = "Leviathan",
                gunName = "BR-155 Battle Gun", pos = new Vector3(600, 0, 450), flagship = true });
            s.Units.Add(new ScenarioUnit { name = "ESCORT-02 JACKAL", team = 0, chassisName = "Jackal",
                gunName = "RB-57 Light Gun", pos = new Vector3(450, 0, 600) });
            s.Units.Add(new ScenarioUnit { name = "RAIDER-01 JACKAL", team = 1, chassisName = "Jackal",
                gunName = "FT-76 Field Gun", pos = new Vector3(1600, 0, 1200) });
            s.Units.Add(new ScenarioUnit { name = "RAIDER-02 JACKAL", team = 1, chassisName = "Jackal",
                gunName = "FT-76 Field Gun", pos = new Vector3(1800, 0, 900) });
            s.Flags.Add(new ScenarioFlag { label = "EXIT", pos = new Vector3(1900, 0, 1900), team = 0, kind = FlagKind.Move });
            return s;
        }
    }
}
