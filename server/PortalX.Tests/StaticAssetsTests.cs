using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace PortalX.Tests;

/// <summary>
/// Bandwidth: 3D models travel Brotli-packed (lossless) to browsers that accept it, and files are revalidated by
/// their content, so a deploy does not make returning browsers download unchanged pictures, fonts or the video again.
/// Needs the built site (client: npm run build, which also writes the models' .br copies).
/// </summary>
[Collection(DatabaseCollection.Name)]
public class StaticAssetsTests(HubIntegrationTests.Factory factory)
{
    private const string Model = "/models/library/library.glb?v=3";
    private string WebRoot => factory.Services.GetRequiredService<IWebHostEnvironment>().WebRootPath;

    private static HttpRequestMessage Get(string url, string? acceptEncoding = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (acceptEncoding != null) req.Headers.TryAddWithoutValidation("Accept-Encoding", acceptEncoding);
        return req;
    }

    [Fact]
    public async Task A_model_is_sent_brotli_packed_to_browsers_that_accept_it_and_unpacks_to_the_same_bytes()
    {
        var original = await File.ReadAllBytesAsync(Path.Combine(WebRoot, "models", "library", "library.glb"));
        var res = await factory.CreateClient().SendAsync(Get(Model, "gzip, deflate, br, zstd"));
        res.EnsureSuccessStatusCode();
        Assert.Equal(["br"], res.Content.Headers.ContentEncoding);
        Assert.Equal("model/gltf-binary", res.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Accept-Encoding", res.Headers.Vary);
        Assert.True(res.Headers.CacheControl!.Extensions.Any(e => e.Name == "immutable"));
        var packed = await res.Content.ReadAsByteArrayAsync();
        Assert.True(packed.Length < original.Length / 2, $"{packed.Length} vs {original.Length}");
        // one layer of Brotli, no more: unpacking once gives back the exact model
        using var unpack = new BrotliStream(new MemoryStream(packed), CompressionMode.Decompress);
        var bytes = new MemoryStream();
        await unpack.CopyToAsync(bytes);
        Assert.Equal(original, bytes.ToArray());
        Assert.Equal("glTF", System.Text.Encoding.ASCII.GetString(bytes.ToArray(), 0, 4));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("gzip, deflate")]
    [InlineData("gzip, br;q=0")]
    public async Task Browsers_without_brotli_get_the_original_model(string? acceptEncoding)
    {
        var original = new FileInfo(Path.Combine(WebRoot, "models", "library", "library.glb")).Length;
        var res = await factory.CreateClient().SendAsync(Get(Model, acceptEncoding));
        res.EnsureSuccessStatusCode();
        Assert.Empty(res.Content.Headers.ContentEncoding);
        Assert.Equal("model/gltf-binary", res.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Accept-Encoding", res.Headers.Vary);
        Assert.Equal(original, (await res.Content.ReadAsByteArrayAsync()).LongLength);
    }

    [Fact]
    public async Task A_range_request_for_a_model_gets_the_original_bytes()
    {
        var req = Get(Model, "br");
        req.Headers.Range = new RangeHeaderValue(0, 3);
        var res = await factory.CreateClient().SendAsync(req);
        Assert.Equal(HttpStatusCode.PartialContent, res.StatusCode);
        Assert.Empty(res.Content.Headers.ContentEncoding);
        Assert.Equal("glTF", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_packed_and_the_original_model_have_different_etags_and_each_revalidates()
    {
        var http = factory.CreateClient();
        var packed = await http.SendAsync(Get(Model, "br"));
        var plain = await http.SendAsync(Get(Model));
        Assert.NotEqual(packed.Headers.ETag, plain.Headers.ETag);
        foreach (var (res, enc) in new[] { (packed, "br"), (plain, (string?)null) })
        {
            var again = Get(Model, enc);
            again.Headers.IfNoneMatch.Add(res.Headers.ETag!);
            var r = await http.SendAsync(again);
            Assert.Equal(HttpStatusCode.NotModified, r.StatusCode);
            Assert.Equal(res.Headers.ETag, r.Headers.ETag);
            Assert.NotNull(r.Headers.CacheControl);
        }
    }

    [Fact]
    public async Task A_stale_brotli_copy_is_never_sent()
    {
        var dir = Path.Combine(WebRoot, "models", "zz-test-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(dir);
        try
        {
            var model = new byte[20000];
            new Random(7).NextBytes(model);
            Array.Fill(model, (byte)1, 0, 15000);
            await File.WriteAllBytesAsync(Path.Combine(dir, "m.glb"), model);
            // a copy made from an older version of the model
            await File.WriteAllBytesAsync(Path.Combine(dir, "m.glb.br"), Pack(new byte[20000]));
            var res = await factory.CreateClient().SendAsync(Get($"/models/{Path.GetFileName(dir)}/m.glb", "br"));
            res.EnsureSuccessStatusCode();
            Assert.Empty(res.Content.Headers.ContentEncoding);
            Assert.Equal(model, await res.Content.ReadAsByteArrayAsync());
        }
        finally { Directory.Delete(dir, true); }
    }

    [Theory]
    // no copy at all, a copy of another model, a file that is not Brotli at all, an empty file: the original
    [InlineData("missing", false)]
    [InlineData("mismatched", false)]
    [InlineData("corrupt", false)]
    [InlineData("empty", false)]
    // a correct copy: sent packed
    [InlineData("valid", true)]
    public async Task Only_a_valid_brotli_copy_is_sent_and_anything_else_falls_back_to_the_original(string copy, bool packed)
    {
        var dir = Path.Combine(WebRoot, "models", "zz-test-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(dir);
        try
        {
            var model = new byte[20000];
            new Random(11).NextBytes(model);
            Array.Fill(model, (byte)1, 0, 15000);
            await File.WriteAllBytesAsync(Path.Combine(dir, "m.glb"), model);
            var br = Path.Combine(dir, "m.glb.br");
            var junk = new byte[5000];
            new Random(3).NextBytes(junk);
            switch (copy)
            {
                case "mismatched": await File.WriteAllBytesAsync(br, Pack(new byte[20000])); break;
                case "corrupt": await File.WriteAllBytesAsync(br, junk); break;
                case "empty": await File.WriteAllBytesAsync(br, []); break;
                case "valid": await File.WriteAllBytesAsync(br, Pack(model)); break;
            }
            var http = factory.CreateClient();
            // twice: the verdict is remembered, and the second answer must be the same
            for (var i = 0; i < 2; i++)
            {
                var res = await http.SendAsync(Get($"/models/{Path.GetFileName(dir)}/m.glb", "gzip, br"));
                Assert.Equal(HttpStatusCode.OK, res.StatusCode);
                Assert.Equal("model/gltf-binary", res.Content.Headers.ContentType?.MediaType);
                var body = await res.Content.ReadAsByteArrayAsync();
                if (packed)
                {
                    Assert.Equal(["br"], res.Content.Headers.ContentEncoding);
                    using var unpack = new BrotliStream(new MemoryStream(body), CompressionMode.Decompress);
                    var bytes = new MemoryStream();
                    await unpack.CopyToAsync(bytes);
                    Assert.Equal(model, bytes.ToArray());
                }
                else
                {
                    Assert.Empty(res.Content.Headers.ContentEncoding);
                    Assert.Equal(model, body);
                }
            }
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public async Task The_etag_follows_the_content_not_the_date_so_a_deploy_does_not_force_a_download()
    {
        var file = Path.Combine(WebRoot, "apple-touch-icon.png");
        var http = factory.CreateClient();
        var first = await http.GetAsync("/apple-touch-icon.png");
        Assert.Null(first.Content.Headers.LastModified);
        var when = File.GetLastWriteTimeUtc(file);
        try
        {
            // a deploy rebuilds the file: same bytes, new date
            File.SetLastWriteTimeUtc(file, when.AddDays(3));
            var again = Get("/apple-touch-icon.png");
            again.Headers.IfNoneMatch.Add(first.Headers.ETag!);
            again.Headers.IfModifiedSince = DateTimeOffset.UtcNow.AddDays(-10);
            var res = await http.SendAsync(again);
            Assert.Equal(HttpStatusCode.NotModified, res.StatusCode);
            Assert.Equal(first.Headers.ETag, res.Headers.ETag);
            // Cloudflare may weaken the ETag of a file it compresses: still recognised
            var weak = Get("/apple-touch-icon.png");
            weak.Headers.TryAddWithoutValidation("If-None-Match", "W/" + first.Headers.ETag!.Tag);
            Assert.Equal(HttpStatusCode.NotModified, (await http.SendAsync(weak)).StatusCode);
        }
        finally { File.SetLastWriteTimeUtc(file, when); }
        // an old ETag: the whole file
        var old = Get("/apple-touch-icon.png");
        old.Headers.IfNoneMatch.Add(new EntityTagHeaderValue("\"0123456789abcdef0123456789abcdef\""));
        Assert.Equal(HttpStatusCode.OK, (await http.SendAsync(old)).StatusCode);
    }

    [Fact]
    public async Task A_resumed_video_download_continues_when_the_file_is_the_same()
    {
        var http = factory.CreateClient();
        var head = await http.SendAsync(new HttpRequestMessage(HttpMethod.Head, "/video/gameplay-showcase.mp4"));
        head.EnsureSuccessStatusCode();
        Assert.Equal("bytes", head.Headers.AcceptRanges.Single());
        var same = Get("/video/gameplay-showcase.mp4");
        same.Headers.Range = new RangeHeaderValue(100, 199);
        same.Headers.IfRange = new RangeConditionHeaderValue(head.Headers.ETag!);
        var r = await http.SendAsync(same);
        Assert.Equal(HttpStatusCode.PartialContent, r.StatusCode);
        Assert.Equal(100, (await r.Content.ReadAsByteArrayAsync()).Length);

        var changed = Get("/video/gameplay-showcase.mp4");
        changed.Headers.Range = new RangeHeaderValue(100, 199);
        changed.Headers.IfRange = new RangeConditionHeaderValue(new EntityTagHeaderValue("\"0123456789abcdef0123456789abcdef\""));
        var full = await http.SendAsync(changed, HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, full.StatusCode);
    }

    [Fact]
    public async Task Hashed_fonts_are_cached_for_a_year()
    {
        var font = Directory.GetFiles(Path.Combine(WebRoot, "media"), "*.woff2").Select(Path.GetFileName).First();
        var res = await factory.CreateClient().GetAsync("/media/" + font);
        res.EnsureSuccessStatusCode();
        Assert.Equal(TimeSpan.FromDays(365), res.Headers.CacheControl!.MaxAge);
        Assert.True(res.Headers.CacheControl.Extensions.Any(e => e.Name == "immutable"));
    }

    [Theory]
    [InlineData("/favicon.ico?v=2", true)]
    [InlineData("/manifest.webmanifest?v=2", false)]
    public async Task Versioned_pictures_are_cached_for_a_year_but_not_the_manifest(string url, bool immutable)
    {
        var res = await factory.CreateClient().GetAsync(url);
        res.EnsureSuccessStatusCode();
        Assert.Equal(immutable, res.Headers.CacheControl!.Extensions.Any(e => e.Name == "immutable"));
    }

    private static byte[] Pack(byte[] data)
    {
        var ms = new MemoryStream();
        using (var b = new BrotliStream(ms, CompressionLevel.SmallestSize, leaveOpen: true)) b.Write(data);
        return ms.ToArray();
    }
}
