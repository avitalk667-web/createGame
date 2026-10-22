using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

public sealed class GameOptions
{
    /// <summary>Overrides the scenario's minimum group size (e.g. 1 for solo testing). Null = use the scenario value (4).</summary>
    public int? MinPlayersOverride { get; set; }
    /// <summary>Length of the opening cinematic; after it any player may advance the room to play.</summary>
    public int IntroSeconds { get; set; } = 52;
    public int WrongAttemptsBeforeCooldown { get; set; } = 3;
    public int CooldownSeconds { get; set; } = 20;
    public int FastFinishMinutes { get; set; } = 25;
}

/// <summary>A message the server announces to the whole group after an action.</summary>
public sealed record GameNotice(string Kind, string Message, string? PlayerId = null, string? PuzzleId = null,
    string? VoiceLine = null, string? ItemId = null, string? Zone = null, int? Points = null);

public sealed record ActionOutcome(bool Ok, string Code, string Message, IReadOnlyList<GameNotice> Notices,
    bool StateChanged, JsonNode? Data = null)
{
    public static ActionOutcome Fail(string code, string message) => new(false, code, message, Array.Empty<GameNotice>(), false);
    public static ActionOutcome Done(string message, params GameNotice[] notices) => new(true, "ok", message, notices, true);
}

/// <summary>
/// Server-side rules of the game. All validation happens here — the client never decides that a puzzle was solved (spec §13).
/// Methods mutate the passed room; the caller persists and broadcasts.
/// </summary>
public sealed partial class GameEngine(ScenarioCatalog catalog, GameOptions options)
{
    public const int MaxNicknameLength = 16;
    public static readonly string[] Characters = ["explorer", "scholar", "navigator", "detective"];

    public ScenarioCatalog Catalog => catalog;
    public GameOptions Options => options;

    public int MinPlayers(ScenarioContent s) => options.MinPlayersOverride ?? s.MinPlayers;

    public int IntroSeconds(ScenarioContent s) => s.IntroSeconds ?? options.IntroSeconds;

    // ---------------------------------------------------------------- room & lobby

    public GameRoom CreateRoom(string scenarioId, string code, string hostClaimHash, DateTime now)
    {
        var scenario = catalog.Get(scenarioId);
        var room = new GameRoom
        {
            Id = Guid.NewGuid(),
            Code = code,
            ScenarioId = scenario.Id,
            Phase = RoomPhase.Lobby,
            HostClaimHash = hostClaimHash,
            CreatedAt = now,
            UpdatedAt = now,
        };
        ResetProgress(room, scenario);
        return room;
    }

    public ActionOutcome AddPlayer(GameRoom room, string nickname, string characterId, string appearanceJson,
        string tokenHash, bool claimsHost, DateTime now, out PlayerSession? player)
    {
        player = null;
        var scenario = catalog.Get(room.ScenarioId);
        if (room.Phase != RoomPhase.Lobby) return ActionOutcome.Fail("game-started", "המשחק בחדר הזה כבר התחיל. אפשר להצטרף לחדר חדש.");
        var active = ActivePlayers(room).ToList();
        if (active.Count >= scenario.MaxPlayers) return ActionOutcome.Fail("room-full", $"החדר מלא — אפשר עד {scenario.MaxPlayers} משתתפים.");

        var nameError = ValidateNickname(nickname);
        if (nameError != null) return ActionOutcome.Fail("bad-nickname", nameError);
        var clean = NormalizeNickname(nickname);
        if (active.Any(p => string.Equals(p.Nickname, clean, StringComparison.OrdinalIgnoreCase)))
            return ActionOutcome.Fail("nickname-taken", "הכינוי הזה כבר תפוס בחדר. בחרו כינוי אחר.");
        if (!Characters.Contains(characterId)) return ActionOutcome.Fail("bad-character", "יש לבחור דמות מהרשימה.");

        player = new PlayerSession
        {
            Id = Guid.NewGuid(),
            RoomId = room.Id,
            Nickname = clean,
            CharacterId = characterId,
            AppearanceJson = SanitizeAppearance(appearanceJson),
            TokenHash = tokenHash,
            Seat = room.Players.Count == 0 ? 0 : room.Players.Max(p => p.Seat) + 1,
            JoinedAt = now,
            LastSeenAt = now,
        };
        room.Players.Add(player);
        if (claimsHost || room.HostPlayerId == null || active.All(p => p.Id != room.HostPlayerId))
            room.HostPlayerId = player.Id;
        room.UpdatedAt = now;
        return ActionOutcome.Done($"{clean} הצטרף לחדר", new GameNotice("player-joined", $"{clean} הצטרף לחדר", player.Id.ToString()));
    }

    public ActionOutcome UpdateProfile(GameRoom room, Guid playerId, string characterId, string appearanceJson)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Lobby) return ActionOutcome.Fail("game-started", "אי אפשר להחליף דמות באמצע המשחק.");
        if (!Characters.Contains(characterId)) return ActionOutcome.Fail("bad-character", "יש לבחור דמות מהרשימה.");
        p.CharacterId = characterId;
        p.AppearanceJson = SanitizeAppearance(appearanceJson);
        return ActionOutcome.Done("הדמות עודכנה");
    }

    public ActionOutcome SetReady(GameRoom room, Guid playerId, bool ready)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Lobby) return ActionOutcome.Fail("game-started", "המשחק כבר התחיל.");
        p.IsReady = ready;
        return ActionOutcome.Done(ready ? "מוכן!" : "לא מוכן");
    }

    public ActionOutcome Leave(GameRoom room, Guid playerId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Lobby)
        {
            p.IsConnected = false;
            return ActionOutcome.Done($"{p.Nickname} יצא מהמשחק", new GameNotice("player-left", $"{p.Nickname} יצא מהמשחק", p.Id.ToString()));
        }
        p.IsRemoved = true;
        p.IsConnected = false;
        p.IsReady = false;
        if (room.HostPlayerId == p.Id)
            room.HostPlayerId = ActivePlayers(room).OrderBy(x => x.Seat).FirstOrDefault()?.Id;
        room.UpdatedAt = now;
        return ActionOutcome.Done($"{p.Nickname} יצא מהחדר", new GameNotice("player-left", $"{p.Nickname} יצא מהחדר", p.Id.ToString()));
    }

    /// <summary>Checks the start conditions (spec §4 step 3) without changing anything.</summary>
    public string? StartBlocker(GameRoom room)
    {
        var scenario = catalog.Get(room.ScenarioId);
        var present = ActivePlayers(room).Where(p => p.IsConnected).ToList();
        var min = MinPlayers(scenario);
        if (present.Count < min) return $"צריך לפחות {min} משתתפים מחוברים כדי להתחיל (כרגע {present.Count}).";
        var notReady = present.Where(p => !p.IsReady && p.Id != room.HostPlayerId).Select(p => p.Nickname).ToList();
        if (notReady.Count > 0) return "ממתינים שכולם יסמנו „מוכן”: " + string.Join(", ", notReady);
        return null;
    }

    public ActionOutcome StartGame(GameRoom room, Guid playerId, DateTime now)
    {
        if (FindPlayer(room, playerId) == null) return NotInRoom();
        if (room.HostPlayerId != playerId) return ActionOutcome.Fail("not-host", "רק המארח יכול להתחיל את המשחק.");
        if (room.Phase != RoomPhase.Lobby) return ActionOutcome.Fail("game-started", "המשחק כבר התחיל.");
        var blocker = StartBlocker(room);
        if (blocker != null) return ActionOutcome.Fail("not-ready", blocker);

        var scenario = catalog.Get(room.ScenarioId);
        ResetProgress(room, scenario);
        room.Phase = RoomPhase.Intro;
        room.IntroStartedAt = now;
        room.StartedAt = null;
        room.EndedAt = null;
        room.UpdatedAt = now;
        return ActionOutcome.Done("ההרפתקה מתחילה!", new GameNotice("intro-started", "ההרפתקה מתחילה!"));
    }

    public ActionOutcome FinishIntro(GameRoom room, Guid playerId, bool skip, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Intro) return new ActionOutcome(true, "noop", "", Array.Empty<GameNotice>(), false);
        if (skip && room.HostPlayerId != playerId) return ActionOutcome.Fail("not-host", "רק המארח יכול לדלג על הפתיחה עבור כולם.");
        var elapsed = now - (room.IntroStartedAt ?? now);
        if (!skip && elapsed.TotalSeconds < IntroSeconds(catalog.Get(room.ScenarioId)) - 5)
            return ActionOutcome.Fail("too-early", "סצנת הפתיחה עדיין מתנגנת.");
        room.Phase = RoomPhase.Playing;
        room.StartedAt = now;
        room.UpdatedAt = now;
        var scenario = catalog.Get(room.ScenarioId);
        var first = scenario.Zones.OrderBy(z => z.Order).First();
        return ActionOutcome.Done("המשימה התחילה",
            new GameNotice("game-started", $"המשימה התחילה! אתם ב{first.Name}.", VoiceLine: first.EntryLine, Zone: first.Id));
    }

    public ActionOutcome PlayAgain(GameRoom room, Guid playerId, DateTime now)
    {
        if (FindPlayer(room, playerId) == null) return NotInRoom();
        if (room.HostPlayerId != playerId) return ActionOutcome.Fail("not-host", "רק המארח יכול להתחיל משחק חוזר.");
        if (room.Phase != RoomPhase.Completed) return ActionOutcome.Fail("not-finished", "המשחק עדיין לא הסתיים.");
        room.Phase = RoomPhase.Lobby;
        room.Round++;
        room.IntroStartedAt = room.StartedAt = room.EndedAt = null;
        foreach (var pl in room.Players) pl.IsReady = false;
        ResetProgress(room, catalog.Get(room.ScenarioId));
        room.UpdatedAt = now;
        return ActionOutcome.Done("חוזרים לחדר ההמתנה", new GameNotice("replay", "המארח פתח משחק חוזר — חוזרים לחדר ההמתנה."));
    }

    // ---------------------------------------------------------------- puzzles

    public ActionOutcome SubmitAnswer(GameRoom room, Guid playerId, string puzzleId, JsonElement answer, DateTime now)
    {
        var check = CheckPuzzleAccess(room, playerId, puzzleId, now, out var scenario, out var puzzle, out var state, out var player);
        if (check != null) return check;
        if (puzzle!.Type == "items") return ActionOutcome.Fail("wrong-action", "את החידה הזאת פותרים בעזרת הנחת חפצים על הכן.");
        if (MechanismTypes.Contains(puzzle.Type)) return ActionOutcome.Fail("wrong-action", "את החידה הזאת פותרים בעזרת המנגנון שבחדר.");

        bool correct;
        try { correct = IsCorrect(puzzle, answer); }
        catch (Exception) { return ActionOutcome.Fail("bad-answer", "התשובה לא נשלחה בצורה תקינה. נסו שוב."); }

        state!.Attempts++;
        if (!correct)
        {
            state.WrongStreak++;
            var msg = puzzle.Failure;
            if (state.WrongStreak >= options.WrongAttemptsBeforeCooldown)
            {
                state.WrongStreak = 0;
                state.CooldownUntil = now.AddSeconds(options.CooldownSeconds);
                msg += $" המנגנון ננעל ל־{options.CooldownSeconds} שניות — נצלו את הזמן לחשוב יחד.";
            }
            room.UpdatedAt = now;
            return new ActionOutcome(false, "wrong", msg,
                [new GameNotice("wrong-answer", $"{player!.Nickname} ניסה תשובה ב„{puzzle.Title}” — {puzzle.Failure}", player.Id.ToString(), puzzle.Id, VoiceLine: $"{puzzle.Id}_fail")],
                true);
        }

        return Solve(room, scenario!, puzzle, state, player!, now);
    }

    public ActionOutcome RequestHint(GameRoom room, Guid playerId, string puzzleId, DateTime now)
    {
        var check = CheckPuzzleAccess(room, playerId, puzzleId, now, out var hintScenario, out var puzzle, out var state, out var player, ignoreCooldown: true);
        if (check != null) return check;
        if (state!.HintsRevealed >= puzzle!.Hints.Count) return ActionOutcome.Fail("no-more-hints", "כבר נחשפו כל הרמזים לחידה הזאת.");
        if (hintScenario!.Scoring is { } rules)
        {
            // an official hint costs the group points of this room, never personal points already earned
            state.HintsRevealed++;
            room.UpdatedAt = now;
            var hint = puzzle.Hints[state.HintsRevealed - 1];
            return ActionOutcome.Done(hint, new GameNotice("hint",
                $"{player!.Nickname} ביקש רמז (−{rules.HintPenalty} לניקוד הקבוצתי של החדר): {hint}",
                player.Id.ToString(), puzzle.Id, Zone: puzzle.Zone, Points: -rules.HintPenalty));
        }
        state.HintsRevealed++;
        room.UpdatedAt = now;
        var level = state.HintsRevealed;
        var levelName = level switch { 1 => "רמז עדין", 2 => "רמז ממוקד", _ => "רמז כמעט מפורש" };
        return ActionOutcome.Done(puzzle.Hints[level - 1],
            new GameNotice("hint", $"{player!.Nickname} ביקש {levelName}: {puzzle.Hints[level - 1]}", player.Id.ToString(), puzzle.Id, VoiceLine: $"{puzzle.Id}_hint{level}"));
    }

    /// <summary>The tune of the sound puzzle is only handed out on request, never in the public state.</summary>
    public ActionOutcome GetTune(GameRoom room, Guid playerId, string puzzleId, DateTime now)
    {
        var check = CheckPuzzleAccess(room, playerId, puzzleId, now, out _, out var puzzle, out _, out _, ignoreCooldown: true, allowSolved: true);
        if (check != null) return check;
        if (puzzle!.Type != "sound") return ActionOutcome.Fail("wrong-action", "לחידה הזאת אין מנגינה.");
        var data = new JsonObject { ["sequence"] = puzzle.Solution["sequence"]!.DeepClone() };
        return new ActionOutcome(true, "ok", "", Array.Empty<GameNotice>(), false, data);
    }

    /// <summary>Split puzzle: each player receives only the clue(s) assigned to their seat (spec §9 „חידה מפוצלת”).</summary>
    public ActionOutcome GetPersonalClues(GameRoom room, Guid playerId, string puzzleId, DateTime now)
    {
        var check = CheckPuzzleAccess(room, playerId, puzzleId, now, out _, out var puzzle, out _, out _, ignoreCooldown: true, allowSolved: true);
        if (check != null) return check;
        if (puzzle!.PersonalClues.Count == 0 && puzzle.PersonalKey.Count == 0)
            return ActionOutcome.Fail("wrong-action", "לחידה הזאת אין רמזים אישיים.");
        var clues = CluesForPlayer(room, puzzle, playerId);
        var arr = new JsonArray(clues.Select(c => (JsonNode)new JsonObject
        {
            ["index"] = c.Index, ["title"] = c.Title, ["text"] = c.Text, ["visual"] = c.Visual,
        }).ToArray());
        var key = new JsonArray(KeyForPlayer(room, puzzle, playerId).Select(k => (JsonNode)new JsonObject
        {
            ["symbol"] = k.Symbol, ["letter"] = k.Letter,
        }).ToArray());
        var parts = SharesForPlayer(room, puzzle.PersonalKey.Count, playerId);
        return new ActionOutcome(true, "ok", "", Array.Empty<GameNotice>(), false, new JsonObject
        {
            ["clues"] = arr, ["key"] = key, ["keyParts"] = parts.Count, ["keyPartsTotal"] = puzzle.PersonalKey.Count,
        });
    }

    public IReadOnlyList<KeyEntry> KeyForPlayer(GameRoom room, PuzzleContent puzzle, Guid playerId) =>
        SharesForPlayer(room, puzzle.PersonalKey.Count, playerId).SelectMany(i => puzzle.PersonalKey[i]).ToList();

    /// <summary>
    /// Splits <paramref name="shareCount"/> pieces of private information between the players (by seat):
    /// with enough players each one holds a single piece; with fewer, pieces are spread so all are covered.
    /// </summary>
    public static IReadOnlyList<int> SharesForPlayer(GameRoom room, int shareCount, Guid playerId)
    {
        var order = ActivePlayers(room).OrderBy(p => p.Seat).Select(p => p.Id).ToList();
        var idx = order.IndexOf(playerId);
        if (idx < 0 || shareCount == 0) return Array.Empty<int>();
        var n = order.Count;
        return Enumerable.Range(0, shareCount).Where(k => n >= shareCount ? idx % shareCount == k : k % n == idx).ToList();
    }

    public IReadOnlyList<PersonalClue> CluesForPlayer(GameRoom room, PuzzleContent puzzle, Guid playerId)
    {
        var shares = SharesForPlayer(room, puzzle.PersonalClues.Count, playerId);
        return puzzle.PersonalClues.Where(c => shares.Contains(c.Index)).ToList();
    }

    // ---------------------------------------------------------------- items

    public ActionOutcome PickUp(GameRoom room, Guid playerId, string itemId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return ActionOutcome.Fail("not-playing", "המשחק אינו פעיל כרגע.");
        var scenario = catalog.Get(room.ScenarioId);
        var item = scenario.Item(itemId);
        var world = World(room);
        if (item == null || !world.WorldItems.Contains(itemId))
            return ActionOutcome.Fail("item-missing", "החפץ כבר נאסף או שאינו כאן.");
        if (!UnlockedZones(room, scenario).Contains(item.Zone)) return ActionOutcome.Fail("zone-locked", "האזור הזה עדיין נעול.");
        world.WorldItems.Remove(itemId);
        world.Inventory.Add(itemId);
        Contribute(world, playerId);
        SaveWorld(room, world, now);
        return ActionOutcome.Done($"אספתם: {item.Name}",
            new GameNotice("item-picked", $"{p.Nickname} מצא {item.Name}!", p.Id.ToString(), ItemId: itemId, VoiceLine: "item_found"));
    }

    public ActionOutcome Combine(GameRoom room, Guid playerId, string a, string b, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return ActionOutcome.Fail("not-playing", "המשחק אינו פעיל כרגע.");
        var scenario = catalog.Get(room.ScenarioId);
        if (!UnlockedZones(room, scenario).Contains("items")) return ActionOutcome.Fail("zone-locked", "שולחן העבודה נמצא בחדר החפצים, שעדיין נעול.");
        var world = World(room);
        if (!world.Inventory.Contains(a) || !world.Inventory.Contains(b) || a == b)
            return ActionOutcome.Fail("item-missing", "צריך שני חפצים שונים שנמצאים אצלכם.");
        var recipe = scenario.Recipes.FirstOrDefault(r => r.Inputs.Count == 2 && r.Inputs.Contains(a) && r.Inputs.Contains(b));
        if (recipe == null) return new ActionOutcome(false, "no-recipe", "החפצים האלה לא מתחברים זה לזה.", Array.Empty<GameNotice>(), false);
        world.Inventory.Remove(a);
        world.Inventory.Remove(b);
        world.Inventory.Add(recipe.Output);
        Contribute(world, playerId);
        SaveWorld(room, world, now);
        return ActionOutcome.Done(recipe.Message,
            new GameNotice("item-combined", $"{p.Nickname}: {recipe.Message}", p.Id.ToString(), ItemId: recipe.Output, VoiceLine: "item_combined"));
    }

    public ActionOutcome PlaceItem(GameRoom room, Guid playerId, string puzzleId, string itemId, DateTime now)
    {
        var check = CheckPuzzleAccess(room, playerId, puzzleId, now, out var scenario, out var puzzle, out var state, out var player);
        if (check != null) return check;
        if (puzzle!.Type != "items") return ActionOutcome.Fail("wrong-action", "אי אפשר להניח חפצים כאן.");
        var world = World(room);
        var required = puzzle.Solution["items"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        if (!world.Inventory.Contains(itemId)) return ActionOutcome.Fail("item-missing", "החפץ הזה אינו אצלכם.");
        if (!required.Contains(itemId))
        {
            state!.Attempts++;
            room.UpdatedAt = now;
            return new ActionOutcome(false, "wrong", "החפץ הזה לא מתאים לאף שקע בכן.", Array.Empty<GameNotice>(), true);
        }
        if (world.PlacedItems.Contains(itemId)) return ActionOutcome.Fail("already-placed", "החפץ כבר מונח על הכן.");
        world.Inventory.Remove(itemId);
        world.PlacedItems.Add(itemId);
        Contribute(world, playerId);
        SaveWorld(room, world, now);
        var item = scenario!.Item(itemId)!;
        if (required.All(world.PlacedItems.Contains))
        {
            state!.Attempts++;
            return Solve(room, scenario, puzzle, state, player!, now);
        }
        return ActionOutcome.Done($"{item.Name} הונח על הכן",
            new GameNotice("item-placed", $"{player!.Nickname} הניח {item.Name} על הכן. חסר עוד חפץ אחד.", player.Id.ToString(), puzzle.Id, ItemId: itemId));
    }

    // ---------------------------------------------------------------- state helpers

    public static IEnumerable<PlayerSession> ActivePlayers(GameRoom room) => room.Players.Where(p => !p.IsRemoved);

    public static PlayerSession? FindPlayer(GameRoom room, Guid playerId) =>
        room.Players.FirstOrDefault(p => p.Id == playerId && !p.IsRemoved);

    public HashSet<string> UnlockedZones(GameRoom room, ScenarioContent scenario)
    {
        var zones = new HashSet<string> { scenario.Zones.OrderBy(z => z.Order).First().Id };
        foreach (var ps in room.Puzzles.Where(x => x.Status == PuzzleStatus.Solved))
        {
            var pc = scenario.Puzzles.FirstOrDefault(p => p.Id == ps.PuzzleId);
            if (pc?.UnlocksZone != null) zones.Add(pc.UnlocksZone);
        }
        return zones;
    }

    public static WorldState World(GameRoom room) =>
        JsonSerializer.Deserialize<WorldState>(string.IsNullOrWhiteSpace(room.WorldJson) ? "{}" : room.WorldJson, ScenarioCatalog.JsonOptions) ?? new WorldState();

    public static void SaveWorld(GameRoom room, WorldState world, DateTime now)
    {
        room.WorldJson = JsonSerializer.Serialize(world, ScenarioCatalog.JsonOptions);
        room.UpdatedAt = now;
    }

    public GameResult BuildResult(GameRoom room)
    {
        var scenario = catalog.Get(room.ScenarioId);
        var world = World(room);
        var duration = (int)Math.Max(0, ((room.EndedAt ?? DateTime.UtcNow) - (room.StartedAt ?? room.EndedAt ?? DateTime.UtcNow)).TotalSeconds);
        var hints = room.Puzzles.Sum(p => p.HintsRevealed);
        var solved = room.Puzzles.Count(p => p.Status == PuzzleStatus.Solved);
        var wrong = room.Puzzles.Sum(p => p.Attempts) - solved;
        var players = ActivePlayers(room).ToList();

        var earned = new List<string> { "team" };
        if (hints == 0) earned.Add("no-hints");
        if (duration < options.FastFinishMinutes * 60) earned.Add("fast");
        if (players.Count > 1 && players.All(p => world.Contributions.GetValueOrDefault(p.Id.ToString()) > 0)) earned.Add("everyone");
        if (wrong <= 2) earned.Add("precise");
        var achievements = scenario.Achievements.Where(a => earned.Contains(a.Id)).ToList();

        return new GameResult
        {
            Id = Guid.NewGuid(),
            RoomId = room.Id,
            ScenarioId = room.ScenarioId,
            Round = room.Round,
            DurationSeconds = duration,
            PlayersCount = players.Count,
            HintsUsed = hints,
            WrongAttempts = Math.Max(0, wrong),
            PuzzlesSolved = solved,
            PuzzlesTotal = scenario.Puzzles.Count,
            AchievementsJson = JsonSerializer.Serialize(achievements, ScenarioCatalog.JsonOptions),
            CompletionType = "success",
            CreatedAt = room.EndedAt ?? DateTime.UtcNow,
        };
    }

    // ---------------------------------------------------------------- internals

    private ActionOutcome Solve(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state, PlayerSession player, DateTime now,
        List<GameNotice>? prior = null)
    {
        state.Status = PuzzleStatus.Solved;
        state.SolvedAt = now;
        state.SolvedByPlayerId = player.Id;
        state.WrongStreak = 0;
        state.CooldownUntil = null;

        var world = World(room);
        Contribute(world, player.Id);
        if (puzzle.RewardLetter != null) world.Letters.Add(new GoldenLetter(puzzle.RewardLetter, puzzle.Zone));
        // The group moves on automatically after a solve, so rewards — and anything still lying in the room
        // being left — go straight into the shared bag instead of requiring a walk back.
        var collected = new List<string>();
        if (puzzle.RewardItem != null && !world.Inventory.Contains(puzzle.RewardItem))
        {
            world.WorldItems.Remove(puzzle.RewardItem);
            world.Inventory.Add(puzzle.RewardItem);
            collected.Add(puzzle.RewardItem);
        }
        if (puzzle.UnlocksZone != null)
        {
            foreach (var left in scenario.Items.Where(i => i.Zone == puzzle.Zone && world.WorldItems.Contains(i.Id)).ToList())
            {
                world.WorldItems.Remove(left.Id);
                world.Inventory.Add(left.Id);
                collected.Add(left.Id);
            }
        }
        var notices = new List<GameNotice>(prior ?? [])
        {
            new("puzzle-solved", $"{player.Nickname} פתר את „{puzzle.Title}”! {puzzle.Success}", player.Id.ToString(), puzzle.Id, VoiceLine: $"{puzzle.Id}_success"),
        };
        if (puzzle.RewardLetter != null)
            notices.Add(new("letter", $"קיבלתם אות זהב: {puzzle.RewardLetter}", PuzzleId: puzzle.Id, Zone: puzzle.Zone));
        if (collected.Count > 0)
            notices.Add(new("item-collected", "נכנס לתיק המשותף: " + string.Join(", ", collected.Select(id => scenario.Item(id)?.Name ?? id)),
                PuzzleId: puzzle.Id, ItemId: collected[0]));
        // puzzles in the same room that waited for this one
        foreach (var next in scenario.Puzzles.Where(p => p.RequiresPuzzle == puzzle.Id))
        {
            var ns = room.Puzzles.First(x => x.PuzzleId == next.Id);
            if (ns.Status == PuzzleStatus.Locked) ns.Status = PuzzleStatus.Active;
        }
        ScoreSolve(room, scenario, puzzle, player, world, now, notices);
        if (puzzle.UnlocksZone != null)
        {
            var zone = scenario.Zones.First(z => z.Id == puzzle.UnlocksZone);
            notices.Add(new("zone-unlocked", scenario.Scoring != null ? $"החדר הבא נפתח! {zone.Name}" : $"נפתחה הדרך אל {zone.Name}",
                Zone: zone.Id, VoiceLine: zone.EntryLine));
            foreach (var next in scenario.Puzzles.Where(p => p.Zone == zone.Id && p.RequiresPuzzle == null))
            {
                var ns = room.Puzzles.First(x => x.PuzzleId == next.Id);
                if (ns.Status == PuzzleStatus.Locked) ns.Status = PuzzleStatus.Active;
            }
        }
        SaveWorld(room, world, now);

        if (scenario.Puzzles.All(p => room.Puzzles.First(x => x.PuzzleId == p.Id).Status == PuzzleStatus.Solved))
        {
            room.Phase = RoomPhase.Completed;
            room.EndedAt = now;
            notices.Add(new("game-completed", scenario.Scoring != null ? puzzle.Success : "הפורטל נפתח — הצלחתם!", VoiceLine: "outro_success"));
        }
        room.UpdatedAt = now;
        return new ActionOutcome(true, "solved", puzzle.Success, notices, true);
    }

    private ActionOutcome? CheckPuzzleAccess(GameRoom room, Guid playerId, string puzzleId, DateTime now,
        out ScenarioContent? scenario, out PuzzleContent? puzzle, out PuzzleState? state, out PlayerSession? player,
        bool ignoreCooldown = false, bool allowSolved = false)
    {
        scenario = null; puzzle = null; state = null;
        player = FindPlayer(room, playerId);
        if (player == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return ActionOutcome.Fail("not-playing", "המשחק אינו פעיל כרגע.");
        scenario = catalog.Get(room.ScenarioId);
        puzzle = scenario.Puzzles.FirstOrDefault(p => p.Id == puzzleId);
        if (puzzle == null) return ActionOutcome.Fail("unknown-puzzle", "החידה לא נמצאה.");
        var pid = puzzle.Id;
        state = room.Puzzles.FirstOrDefault(x => x.PuzzleId == pid);
        if (state == null || state.Status == PuzzleStatus.Locked) return ActionOutcome.Fail("locked", "החידה הזאת עדיין נעולה. התקדמו קודם בחדרים הקודמים.");
        if (state.Status == PuzzleStatus.Solved && !allowSolved) return ActionOutcome.Fail("already-solved", "החידה הזאת כבר נפתרה.");
        if (!ignoreCooldown && state.CooldownUntil is { } until && until > now)
            return ActionOutcome.Fail("cooldown", $"המנגנון נעול עוד {Math.Ceiling((until - now).TotalSeconds)} שניות.");
        return null;
    }

    private void ResetProgress(GameRoom room, ScenarioContent scenario)
    {
        var first = scenario.Zones.OrderBy(z => z.Order).First().Id;
        // Reset in place so tracked rows are updated rather than deleted and re-inserted with the same key.
        foreach (var p in scenario.Puzzles.OrderBy(p => p.Order))
        {
            var s = room.Puzzles.FirstOrDefault(x => x.PuzzleId == p.Id);
            if (s == null) room.Puzzles.Add(s = new PuzzleState { RoomId = room.Id, PuzzleId = p.Id });
            s.Status = p.Zone == first && p.RequiresPuzzle == null ? PuzzleStatus.Active : PuzzleStatus.Locked;
            s.Attempts = s.WrongStreak = s.HintsRevealed = 0;
            s.CooldownUntil = s.SolvedAt = null;
            s.SolvedByPlayerId = null;
        }
        var world = new WorldState
        {
            WorldItems = scenario.Items.Where(i => i.SpawnedAtStart).Select(i => i.Id).ToList(),
            Mechanisms = scenario.Puzzles.Where(p => MechanismTypes.Contains(p.Type)).ToDictionary(p => p.Id, NewMechanism),
            Score = scenario.Scoring != null ? new ScoreBoard() : null,
        };
        room.WorldJson = JsonSerializer.Serialize(world, ScenarioCatalog.JsonOptions);
    }

    private static void Contribute(WorldState world, Guid playerId)
    {
        var key = playerId.ToString();
        world.Contributions[key] = world.Contributions.GetValueOrDefault(key) + 1;
    }

    private static ActionOutcome NotInRoom() => ActionOutcome.Fail("not-in-room", "אינכם רשומים בחדר הזה. הצטרפו מחדש בעזרת קוד החדר.");

    private static bool IsCorrect(PuzzleContent puzzle, JsonElement answer)
    {
        switch (puzzle.Type)
        {
            case "cipher":
            case "final":
            case "split":
            {
                var accepted = new List<string> { puzzle.Solution["text"]!.GetValue<string>() };
                if (puzzle.Solution["accept"] is JsonArray alternatives) accepted.AddRange(alternatives.Select(n => n!.GetValue<string>()));
                string given = answer.ValueKind switch
                {
                    JsonValueKind.String => answer.GetString() ?? "",
                    JsonValueKind.Array => string.Concat(answer.EnumerateArray().Select(e => e.GetString())),
                    JsonValueKind.Object when answer.TryGetProperty("text", out var t) => t.GetString() ?? "",
                    _ => "",
                };
                return accepted.Select(NormalizeText).Contains(NormalizeText(given));
            }
            case "sequence":
            case "sound":
            {
                var expected = puzzle.Solution["sequence"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
                var arr = answer.ValueKind == JsonValueKind.Object && answer.TryGetProperty("sequence", out var s) ? s : answer;
                if (arr.ValueKind != JsonValueKind.Array) return false;
                var given = arr.EnumerateArray().Select(e => e.GetString() ?? "").ToList();
                return given.SequenceEqual(expected);
            }
            default:
                return false;
        }
    }

    /// <summary>Normalizes Hebrew text answers: removes niqqud, spaces and punctuation; final letters become regular forms.</summary>
    public static string NormalizeText(string s)
    {
        var sb = new StringBuilder();
        foreach (var ch in s.Normalize(NormalizationForm.FormD))
        {
            var cat = CharUnicodeInfo.GetUnicodeCategory(ch);
            if (cat == UnicodeCategory.NonSpacingMark) continue;
            if (!char.IsLetterOrDigit(ch)) continue;
            sb.Append(ch switch { 'ך' => 'כ', 'ם' => 'מ', 'ן' => 'נ', 'ף' => 'פ', 'ץ' => 'צ', _ => char.ToLowerInvariant(ch) });
        }
        return sb.ToString();
    }

    public static string NormalizeNickname(string nickname) =>
        string.Join(' ', (nickname ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));

    public static string? ValidateNickname(string nickname)
    {
        var n = NormalizeNickname(nickname);
        if (n.Length < 2) return "הכינוי צריך להכיל לפחות שני תווים.";
        if (n.Length > MaxNicknameLength) return $"הכינוי יכול להכיל עד {MaxNicknameLength} תווים.";
        if (!n.All(c => char.IsLetterOrDigit(c) || c == ' ' || c == '-' || c == '_' || c == '\''))
            return "הכינוי יכול להכיל רק אותיות, ספרות ורווחים.";
        if (ContentFilter.ContainsBlocked(n)) return "יש לבחור כינוי מכבד.";
        return null;
    }

    private static readonly HashSet<string> AllowedAppearanceKeys = ["skin", "hair", "glasses", "bag"];

    public static string SanitizeAppearance(string json)
    {
        var result = new JsonObject();
        try
        {
            if (JsonNode.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json) is JsonObject obj)
                foreach (var (k, v) in obj)
                    if (AllowedAppearanceKeys.Contains(k) && v is JsonValue val && val.TryGetValue<int>(out var i) && i is >= 0 and < 6)
                        result[k] = i;
        }
        catch (JsonException) { }
        return result.ToJsonString();
    }
}
