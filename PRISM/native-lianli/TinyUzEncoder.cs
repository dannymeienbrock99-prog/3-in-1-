namespace Prism.LianLi;

// Bounded greedy LZ77 encoder interoperable with tinyuz 1.1.1.
// Wire coding adapted from sisong/tinyuz 1d74ffa4d453796df352df470733f45dfa099bb1 (MIT).
// Uses a 4 KiB dictionary and at most 64 match candidates; it does not invoke external libraries.
internal static class TinyUzEncoder
{
    internal static byte[] Compress(byte[] input)
    {
        if (input.Length is < 1 or > WirelessProtocol.MaximumRawBytes) throw new ArgumentException("Invalid tinyuz input size");
        var output = new List<byte>(input.Length + input.Length / 8 + 16) { 0, 16, 0, 0 };
        int typeCount = 0, typeIndex = 0;
        bool haveLiteral = false;
        void Bit(int value)
        {
            if (typeCount == 0) { typeIndex = output.Count; output.Add(0); }
            output[typeIndex] |= (byte)(value << typeCount);
            typeCount = (typeCount + 1) & 7;
        }
        void Length(int value, int packBits)
        {
            int count = 1;
            while (value >= (1 << (count * packBits))) { value -= 1 << (count * packBits); count++; }
            for (int part = count - 1; part >= 0; part--)
            {
                for (int bit = 0; bit < packBits; bit++) Bit((value >> (part * packBits + bit)) & 1);
                Bit(part > 0 ? 1 : 0);
            }
        }
        void Offset(int distance)
        {
            if (distance < 128) output.Add((byte)distance);
            else { distance -= 128; output.Add((byte)((distance & 127) | 128)); Length(distance >> 7, 2); }
        }
        var heads = new int[65536]; Array.Fill(heads, -1);
        var previous = new int[4096]; Array.Fill(previous, -1);
        int Key(int position) => (input[position] << 8) | input[position + 1];
        void Remember(int position)
        {
            if (position + 1 >= input.Length) return;
            var key = Key(position); previous[position & 4095] = heads[key]; heads[key] = position;
        }
        for (int position = 0; position < input.Length;)
        {
            int bestLength = 0, bestDistance = 0;
            if (position + 2 < input.Length)
            {
                int candidate = heads[Key(position)], remaining = input.Length - position, attempts = 0;
                while (candidate >= 0 && position - candidate <= 4096 && attempts++ < 64)
                {
                    int distance = position - candidate;
                    if (distance < 1) break;
                    int length = 2;
                    while (length < remaining && input[candidate + length] == input[position + length]) length++;
                    if (length > bestLength && length >= (distance > 2687 ? 4 : 3))
                    { bestLength = length; bestDistance = distance; if (length == remaining) break; }
                    var next = previous[candidate & 4095];
                    if (next >= candidate) break; candidate = next;
                }
            }
            if (bestLength >= 3)
            {
                Bit(0); Length(bestLength - 2 - (bestDistance > 2687 ? 1 : 0), 1);
                if (haveLiteral) Bit(0); Offset(bestDistance); haveLiteral = false;
                for (int consumed = 0; consumed < bestLength; consumed++) Remember(position + consumed);
                position += bestLength;
            }
            else { Bit(1); output.Add(input[position]); haveLiteral = true; Remember(position++); }
        }
        Bit(0); Length(3, 1); if (haveLiteral) Bit(0); Offset(0);
        return output.ToArray();
    }
}
