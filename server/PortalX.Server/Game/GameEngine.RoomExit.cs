using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// The free game ("שער הסודות" 2.0): a room is left only through its door, and its door is the room's last step.
/// An "exitdoor" puzzle (publicData.roomExit) opens the next room; it unlocks only when every other puzzle of its room is
/// solved (checked here on the server, whatever a client sends) and only with its key in the group's bag (the key stays —
/// it is not used up). Only scenarios with an "exitdoor" puzzle reach this code; the paid games open their rooms as before.
/// </summary>
public sealed partial class GameEngine
{
    /// <summary>The other puzzles of the door's room that are not solved yet (a bonus puzzle never holds a door).</summary>
    public static IReadOnlyList<string> RoomStillOpen(GameRoom room, ScenarioContent scenario, PuzzleContent door) =>
        scenario.Puzzles.Where(p => p.Zone == door.Zone && p.Id != door.Id && !p.Bonus)
            .Where(p => room.Puzzles.FirstOrDefault(s => s.PuzzleId == p.Id)?.Status != PuzzleStatus.Solved)
            .Select(p => p.Id).ToList();

    private ActionOutcome OperateExitDoor(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, string op, JsonElement action, DateTime now)
    {
        if (op != "unlock") return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        var data = puzzle.PublicData;
        // never before the whole room is done, even if a client asks
        if (RoomStillOpen(room, scenario, puzzle).Count > 0)
            return ActionOutcome.Fail("room-not-done", data["lockedMessage"]?.GetValue<string>() ?? "הדלת עדיין נעולה.");
        var key = data["needsItem"]?.GetValue<string>();
        if (key != null && !world.Inventory.Contains(key))
            return ActionOutcome.Fail("no-key", data["noItemMessage"]?.GetValue<string>() ?? "צריך מפתח כדי לפתוח את הדלת.");
        // the final gate: the room must be the right way up, and only the exit code from the cell opens it
        if (data["blockedWhileFlipped"]?.GetValue<string>() is { } rod && world.Mechanisms.TryGetValue(rod, out var g) && (g.Running || (g.StartedAt is { } st && now < st + FlipTime)))
            return ActionOutcome.Fail("flipped", data["flippedMessage"]?.GetValue<string>() ?? "החזירו קודם את החדר למצבו הרגיל.");
        if (puzzle.Solution["code"]?.GetValue<string>() is { } code && CodeArg(action) != code)
            return new ActionOutcome(false, "wrong", WrongCode(state, now, puzzle.Failure),
                [new("wrong-answer", $"{player.Nickname} ניסה קוד בשער — הקוד שגוי", player.Id.ToString(), puzzle.Id)], true);
        Contribute(world, player.Id);
        state.Attempts++;
        SaveWorld(room, world, now);
        return Solve(room, scenario, puzzle, state, player, now,
            [new("door-unlocked", $"{player.Nickname} פתח את {puzzle.Title}", player.Id.ToString(), puzzle.Id)]);
    }
}
