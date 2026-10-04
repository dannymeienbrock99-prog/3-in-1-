// Independently implemented compatibility codec. No Kingston DLL, driver or
// decompiled source is embedded. This executable has no network/hardware API.
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

internal static class PrismKingstonCodec
{
    const int MaxText = 262144;
    // Public protocol constant documented by Beej126/KingstonFuryRgbCLI.
    // This is a vendor wire-format constant, not a user/account credential.
    const string ProtocolKey = "3m23s45i599";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxText * 2 };
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

    static byte[] RandomBytes(int length)
    {
        var bytes = new byte[length];
        using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
        return bytes;
    }

    static string Encrypt(string value)
    {
        byte[] salt = RandomBytes(32), iv = RandomBytes(32);
        byte[] plain = Utf8.GetBytes(value), cipher;
        using (var derivation = new Rfc2898DeriveBytes(ProtocolKey, salt, 1000))
        using (var rijndael = new RijndaelManaged { BlockSize = 256, KeySize = 256, Mode = CipherMode.CBC, Padding = PaddingMode.PKCS7 })
        using (var transform = rijndael.CreateEncryptor(derivation.GetBytes(32), iv))
            cipher = transform.TransformFinalBlock(plain, 0, plain.Length);
        byte[] packet = new byte[64 + cipher.Length];
        Buffer.BlockCopy(salt, 0, packet, 0, 32);
        Buffer.BlockCopy(iv, 0, packet, 32, 32);
        Buffer.BlockCopy(cipher, 0, packet, 64, cipher.Length);
        return Convert.ToBase64String(packet);
    }

    static string Decrypt(string value)
    {
        byte[] packet = Convert.FromBase64String(value);
        if (packet.Length < 96 || (packet.Length - 64) % 32 != 0 || packet.Length > MaxText)
            throw new FormatException("Invalid encrypted packet size");
        byte[] salt = new byte[32], iv = new byte[32], plain;
        Buffer.BlockCopy(packet, 0, salt, 0, 32);
        Buffer.BlockCopy(packet, 32, iv, 0, 32);
        using (var derivation = new Rfc2898DeriveBytes(ProtocolKey, salt, 1000))
        using (var rijndael = new RijndaelManaged { BlockSize = 256, KeySize = 256, Mode = CipherMode.CBC, Padding = PaddingMode.PKCS7 })
        using (var transform = rijndael.CreateDecryptor(derivation.GetBytes(32), iv))
            plain = transform.TransformFinalBlock(packet, 64, packet.Length - 64);
        return Utf8.GetString(plain);
    }

    static int Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            object requestId = null;
            try
            {
                if (line.Length > MaxText * 2) throw new FormatException("Packet too large");
                var request = Json.Deserialize<Dictionary<string, object>>(line);
                requestId = request["requestId"];
                string command = Convert.ToString(request["command"]), data = Convert.ToString(request["data"]);
                if (data.Length > MaxText) throw new FormatException("Packet too large");
                string result;
                if (command == "encrypt") result = Encrypt(data);
                else if (command == "decrypt") result = Decrypt(data);
                else throw new FormatException("Unsupported codec command");
                Console.WriteLine(Json.Serialize(new { requestId = requestId, ok = true, result = result }));
            }
            catch (Exception)
            {
                Console.WriteLine(Json.Serialize(new { requestId = requestId, ok = false, error = "KINGSTON_CODEC_DATA" }));
            }
        }
        return 0;
    }
}
