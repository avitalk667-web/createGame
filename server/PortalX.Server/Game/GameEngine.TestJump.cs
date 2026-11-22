using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// TESTING ONLY (local previews): takes the group straight to a later room. Every puzzle of the rooms before it is solved
/// in order through the normal <see cref="Solve"/>, so rewards, the shared bag, scoring and opened rooms are exactly what
/// a group that played them would have. Off unless Game:TestJumps is true; the hub also refuses it in Production.
/// </summary>
public sealed partial class GameEngine
{
    public bool TestJumpsEnabled => options.TestJumps;

    public ActionOutcome TestJump(GameRoom room, Guid playerId, string zoneId, DateTime now)
    {
        if (!options.TestJumps) return ActionOutcome.Fail("not-allowed", "מעבר בין חדרים זמין רק בסביבת בדיקה.");
        var player = FindPlayer(room, playerId);
        if (player == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return ActionOutcome.Fail("not-playing", "המשחק אינו פעיל כרגע.");
        var scenario = catalog.Get(room.ScenarioId);
        var target = scenario.Zones.FirstOrDefault(z => z.Id == zoneId);
        if (target == null) return ActionOutcome.Fail("unknown-zone", "החדר לא נמצא.");
        var current = scenario.Zones.First(z => z.Id == CurrentZone(room).Zone);
        if (target.Order <= current.Order) return ActionOutcome.Fail("behind", "אפשר לקפוץ רק קדימה. כדי להתחיל מחדש פתחו משחק חדש.");

        var zoneOrder = scenario.Zones.ToDictionary(z => z.Id, z => z.Order);
        var before = scenario.Puzzles
            .Select((p, i) => (p, i))
            .Where(x => !x.p.Bonus && zoneOrder.GetValueOrDefault(x.p.Zone, int.MaxValue) < target.Order)
            .OrderBy(x => zoneOrder[x.p.Zone]).ThenBy(x => x.i)
            .Select(x => x.p);
        foreach (var puzzle in before)
        {
            var state = room.Puzzles.FirstOrDefault(x => x.PuzzleId == puzzle.Id);
            if (state == null || state.Status == PuzzleStatus.Solved) continue;
            state.Status = PuzzleStatus.Active;
            Solve(room, scenario, puzzle, state, player, now);
            if (room.Phase != RoomPhase.Playing) break;
        }

        var world = World(room);
        world.CurrentZone = target.Id;
        world.CurrentZoneSince = now;
        world.PendingZone = null;
        world.PendingSince = null;
        SaveWorld(room, world, now);
        return ActionOutcome.Done($"בדיקה: עוברים אל {target.Name}",
            new GameNotice("zone-entered", $"בדיקה: עוברים אל {target.Name}", player.Id.ToString(), Zone: target.Id, VoiceLine: target.EntryLine));
    }
}
