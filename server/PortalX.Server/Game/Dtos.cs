using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

public sealed record PlayerDto(Guid Id, string Nickname, string CharacterId, JsonNode? Appearance, int Seat,
    bool IsReady, bool IsConnected, bool IsHost);

public sealed record PuzzleStateDto(string Id, string Status, int Attempts, int HintsRevealed, IReadOnlyList<string> Hints,
    DateTime? CooldownUntil, Guid? SolvedBy, DateTime? SolvedAt);

public sealed record ResultDto(int DurationSeconds, int PlayersCount, int HintsUsed, int WrongAttempts, int PuzzlesSolved,
    int PuzzlesTotal, JsonNode? Achievements);

public sealed record RoomSnapshot(
    Guid RoomId, string Code, string ScenarioId, string Phase, int Round, Guid? HostPlayerId,
    IReadOnlyList<PlayerDto> Players, int MinPlayers, int MaxPlayers, string? StartBlocker,
    DateTime? IntroStartedAt, DateTime? StartedAt, DateTime? EndedAt, DateTime ServerNow, int IntroSeconds,
    IReadOnlyList<string> UnlockedZones, IReadOnlyList<PuzzleStateDto> Puzzles,
    IReadOnlyList<string> Inventory, IReadOnlyList<string> WorldItems, IReadOnlyList<string> PlacedItems,
    IReadOnlyList<GoldenLetter> Letters, ResultDto? Result);

public static class Snapshots
{
    public static RoomSnapshot Build(GameEngine engine, GameRoom room, GameResult? result, DateTime now)
    {
        var scenario = engine.Catalog.Get(room.ScenarioId);
        var world = GameEngine.World(room);
        var players = GameEngine.ActivePlayers(room).OrderBy(p => p.Seat).Select(p => new PlayerDto(
            p.Id, p.Nickname, p.CharacterId, JsonNode.Parse(p.AppearanceJson), p.Seat, p.IsReady, p.IsConnected,
            p.Id == room.HostPlayerId)).ToList();
        var puzzles = scenario.Puzzles.OrderBy(p => p.Order).Select(pc =>
        {
            var s = room.Puzzles.First(x => x.PuzzleId == pc.Id);
            return new PuzzleStateDto(pc.Id, s.Status.ToString().ToLowerInvariant(), s.Attempts, s.HintsRevealed,
                pc.Hints.Take(s.HintsRevealed).ToList(), s.CooldownUntil > now ? s.CooldownUntil : null, s.SolvedByPlayerId, s.SolvedAt);
        }).ToList();

        return new RoomSnapshot(room.Id, room.Code, room.ScenarioId, room.Phase.ToString().ToLowerInvariant(), room.Round,
            room.HostPlayerId, players, engine.MinPlayers(scenario), scenario.MaxPlayers,
            room.Phase == RoomPhase.Lobby ? engine.StartBlocker(room) : null,
            room.IntroStartedAt, room.StartedAt, room.EndedAt, now, engine.Options.IntroSeconds,
            engine.UnlockedZones(room, scenario).ToList(), puzzles,
            world.Inventory, world.WorldItems, world.PlacedItems, world.Letters,
            result == null ? null : new ResultDto(result.DurationSeconds, result.PlayersCount, result.HintsUsed,
                result.WrongAttempts, result.PuzzlesSolved, result.PuzzlesTotal, JsonNode.Parse(result.AchievementsJson)));
    }

    /// <summary>Scenario content safe for clients: solutions, personal clues and unrevealed hints are removed (spec §19).</summary>
    public static JsonObject PublicScenario(ScenarioContent s)
    {
        var node = JsonSerializer.SerializeToNode(s, ScenarioCatalog.JsonOptions)!.AsObject();
        node.Remove("finalWord");
        foreach (var p in node["puzzles"]!.AsArray())
        {
            var o = p!.AsObject();
            o.Remove("solution");
            o.Remove("personalClues");
            o.Remove("personalKey");
            o.Remove("hints");
        }
        return node;
    }
}
