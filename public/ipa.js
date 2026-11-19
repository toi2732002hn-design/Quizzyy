'use strict';
// Bảng phiên âm IPA theo Cambridge Dictionary (giọng Anh – Anh, kèm biến thể Anh – Mỹ)
// Mỗi âm: ký hiệu, từ ví dụ (phần in đậm là chữ cái tạo ra âm), phiên âm ví dụ, mẹo đọc cho người Việt.
window.IPA = (() => {
  const groups = [
    {
      key: 'short',
      title: 'Nguyên âm đơn ngắn',
      desc: 'Phát âm nhanh, gọn, không kéo dài.',
      items: [
        { s: 'ɪ', w: 'sit', h: 'i', ipa: '/sɪt/', tip: 'Giống “i” tiếng Việt nhưng rất ngắn và hơi mở miệng, gần “ê”. Như “ít”.' },
        { s: 'e', w: 'bed', h: 'e', ipa: '/bed/', tip: 'Giống “e” tiếng Việt, ngắn. Miệng mở vừa.' },
        { s: 'æ', w: 'cat', h: 'a', ipa: '/kæt/', tip: 'Âm lai giữa “a” và “e”: há miệng rộng, kéo khóe miệng sang hai bên, lưỡi hạ thấp.' },
        { s: 'ʌ', w: 'cup', h: 'u', ipa: '/kʌp/', tip: 'Giống “ă” tiếng Việt (như trong “cắp”). Ngắn, bật nhanh.' },
        { s: 'ɒ', w: 'hot', h: 'o', ipa: '/hɒt/', tip: 'Giống “o” ngắn, tròn môi, hơi há miệng (giọng Anh). Giọng Mỹ đọc thành /ɑː/: /hɑːt/.' },
        { s: 'ʊ', w: 'book', h: 'oo', ipa: '/bʊk/', tip: 'Giống “u” tiếng Việt nhưng ngắn, môi tròn nhẹ, không chu môi nhiều.' },
        { s: 'ə', w: 'about', h: 'a', ipa: '/əˈbaʊt/', tip: 'Âm “ơ” rất nhẹ và ngắn (schwa). Âm phổ biến nhất trong tiếng Anh, luôn ở âm tiết không nhấn.' },
        { s: 'i', w: 'happy', h: 'y', ipa: '/ˈhæp.i/', tip: 'Giống “i” tiếng Việt, xuất hiện ở âm tiết không nhấn (thường cuối từ).' },
        { s: 'u', w: 'usual', h: 'u', ipa: '/ˈjuː.ʒu.əl/', tip: 'Giống “u” ngắn, ở âm tiết không nhấn.' },
      ],
    },
    {
      key: 'long',
      title: 'Nguyên âm đơn dài',
      desc: 'Dấu ː nghĩa là kéo dài âm. Đọc dài gấp khoảng hai lần nguyên âm ngắn.',
      items: [
        { s: 'iː', w: 'see', h: 'ee', ipa: '/siː/', tip: '“i” kéo dài, khóe miệng kéo căng sang hai bên như đang cười. Phân biệt: ship /ʃɪp/ ≠ sheep /ʃiːp/.' },
        { s: 'ɑː', w: 'father', h: 'a', ipa: '/ˈfɑː.ðər/', tip: '“a” kéo dài, há miệng rộng, lưỡi hạ thấp về phía sau.' },
        { s: 'ɔː', w: 'door', h: 'oo', ipa: '/dɔːr/', tip: '“o” kéo dài, môi tròn và hơi chu ra.' },
        { s: 'uː', w: 'blue', h: 'ue', ipa: '/bluː/', tip: '“u” kéo dài, chu môi tròn về phía trước. Phân biệt: full /fʊl/ ≠ fool /fuːl/.' },
        { s: 'ɜː', w: 'bird', h: 'ir', ipa: '/bɜːd/', tip: '“ơ” kéo dài, miệng mở vừa, lưỡi để giữa. Giọng Mỹ viết /ɝː/ và uốn lưỡi (âm “r”): /bɝːd/.' },
      ],
    },
    {
      key: 'diph',
      title: 'Nguyên âm đôi',
      desc: 'Trượt từ âm thứ nhất sang âm thứ hai, âm đầu đọc rõ và dài hơn.',
      items: [
        { s: 'eɪ', w: 'day', h: 'ay', ipa: '/deɪ/', tip: 'Giống “ây” (e → i). Như “đây”.' },
        { s: 'aɪ', w: 'my', h: 'y', ipa: '/maɪ/', tip: 'Giống “ai”. Như “mai”.' },
        { s: 'ɔɪ', w: 'boy', h: 'oy', ipa: '/bɔɪ/', tip: 'Giống “oi”. Như “bói”.' },
        { s: 'aʊ', w: 'now', h: 'ow', ipa: '/naʊ/', tip: 'Giống “ao”. Như “nao”.' },
        { s: 'əʊ', w: 'go', h: 'o', ipa: '/ɡəʊ/', tip: 'Giọng Anh: “ơ” trượt sang “u” (gần “âu”). Giọng Mỹ: /oʊ/ – “ô” trượt sang “u”.' },
        { s: 'oʊ', w: 'go', h: 'o', ipa: '/ɡoʊ/', tip: 'Giọng Mỹ: “ô” trượt sang “u” (gần “ôu”).', us: true },
        { s: 'ɪə', w: 'near', h: 'ea', ipa: '/nɪər/', tip: 'Giống “ia”. Như “nia”. (Giọng Mỹ thường là /ɪr/.)' },
        { s: 'eə', w: 'hair', h: 'ai', ipa: '/heər/', tip: '“e” trượt sang “ơ” (gần “e-ơ”). (Giọng Mỹ thường là /er/.)' },
        { s: 'ʊə', w: 'tour', h: 'ou', ipa: '/tʊər/', tip: 'Giống “ua”. Như “tua”. (Giọng Mỹ thường là /ʊr/.)' },
      ],
    },
    {
      key: 'cons',
      title: 'Phụ âm',
      desc: 'Xếp theo cặp: bên trái vô thanh (không rung cổ họng), bên phải hữu thanh (rung cổ họng). Đặt tay lên cổ để cảm nhận.',
      items: [
        { s: 'p', w: 'pen', h: 'p', ipa: '/pen/', tip: 'Mím môi rồi bật mạnh hơi ra (bật hơi nhiều hơn “p” tiếng Việt).' },
        { s: 'b', w: 'bad', h: 'b', ipa: '/bæd/', tip: 'Như “b” tiếng Việt, rung cổ họng.' },
        { s: 't', w: 'tea', h: 't', ipa: '/tiː/', tip: 'Đầu lưỡi chạm lợi trên rồi bật hơi – nghe gần “th” tiếng Việt.' },
        { s: 'd', w: 'day', h: 'd', ipa: '/deɪ/', tip: 'Đầu lưỡi chạm lợi trên, rung cổ – gần “đ”.' },
        { s: 'k', w: 'cat', h: 'c', ipa: '/kæt/', tip: 'Như “c/k” nhưng bật hơi mạnh – gần “kh” nhẹ.' },
        { s: 'ɡ', w: 'go', h: 'g', ipa: '/ɡəʊ/', tip: 'Như “g” tiếng Việt.' },
        { s: 'f', w: 'fish', h: 'f', ipa: '/fɪʃ/', tip: 'Răng trên chạm môi dưới, thổi hơi – như “ph”.' },
        { s: 'v', w: 'van', h: 'v', ipa: '/væn/', tip: 'Như /f/ nhưng rung cổ họng – như “v”.' },
        { s: 'θ', w: 'think', h: 'th', ipa: '/θɪŋk/', tip: 'Đặt đầu lưỡi giữa hai hàm răng, thổi hơi ra (không rung). Không đọc là “th” hay “t”.' },
        { s: 'ð', w: 'this', h: 'th', ipa: '/ðɪs/', tip: 'Như /θ/ nhưng rung cổ họng – gần “đ” đặt lưỡi giữa răng.' },
        { s: 's', w: 'see', h: 's', ipa: '/siː/', tip: 'Như “x” tiếng Việt. Ở cuối từ phải đọc rõ: bus /bʌs/.' },
        { s: 'z', w: 'zoo', h: 'z', ipa: '/zuː/', tip: 'Như “d” giọng Bắc (rung, có tiếng “zzz”).' },
        { s: 'ʃ', w: 'she', h: 'sh', ipa: '/ʃiː/', tip: 'Chu môi, uốn lưỡi – như “s” nặng (giọng Nam) hay tiếng “suỵt”.' },
        { s: 'ʒ', w: 'vision', h: 's', ipa: '/ˈvɪʒ.ən/', tip: 'Như /ʃ/ nhưng rung cổ họng – gần “gi” uốn lưỡi.' },
        { s: 'tʃ', w: 'chair', h: 'ch', ipa: '/tʃeər/', tip: 'Như “ch” nhưng chu môi và bật hơi mạnh.' },
        { s: 'dʒ', w: 'job', h: 'j', ipa: '/dʒɒb/', tip: 'Như /tʃ/ nhưng rung cổ – gần “dj”, “gi” bật mạnh.' },
        { s: 'm', w: 'man', h: 'm', ipa: '/mæn/', tip: 'Như “m”.' },
        { s: 'n', w: 'no', h: 'n', ipa: '/nəʊ/', tip: 'Như “n”.' },
        { s: 'ŋ', w: 'sing', h: 'ng', ipa: '/sɪŋ/', tip: 'Như “ng”. Không bật thêm âm /ɡ/ ở cuối.' },
        { s: 'h', w: 'hat', h: 'h', ipa: '/hæt/', tip: 'Như “h”, thổi hơi nhẹ.' },
        { s: 'l', w: 'leg', h: 'l', ipa: '/leɡ/', tip: 'Như “l”. Ở cuối từ (feel, call) cong lưỡi lên – “l tối”, không bỏ âm.' },
        { s: 'r', w: 'red', h: 'r', ipa: '/red/', tip: 'Uốn cong đầu lưỡi về phía sau, không chạm vòm miệng, không rung lưỡi như “r” tiếng Việt.' },
        { s: 'w', w: 'wet', h: 'w', ipa: '/wet/', tip: 'Chu tròn môi rồi mở ra nhanh – gần “qu/oa” (như “oét”).' },
        { s: 'j', w: 'yes', h: 'y', ipa: '/jes/', tip: 'Như “i” lướt nhanh vào nguyên âm sau – gần “d” giọng Nam (“dét”).' },
      ],
    },
    {
      key: 'us',
      title: 'Âm đặc trưng giọng Mỹ (US)',
      desc: 'Cambridge ghi phiên âm Mỹ riêng; đây là các ký hiệu bạn sẽ gặp.',
      items: [
        { s: 'ɝː', w: 'bird', h: 'ir', ipa: '/bɝːd/', tip: '“ơ” dài kèm uốn lưỡi (âm r).', us: true },
        { s: 'ɚ', w: 'teacher', h: 'er', ipa: '/ˈtiː.tʃɚ/', tip: '“ơ” ngắn kèm uốn lưỡi, ở âm tiết không nhấn.', us: true },
        { s: 't̬', w: 'water', h: 't', ipa: '/ˈwɑː.t̬ɚ/', tip: '“t” giữa hai nguyên âm đọc nhẹ như “đ” lướt (flap T).', us: true },
      ],
    },
  ];

  const marks = [
    { s: 'ˈ', tip: 'Trọng âm chính: âm tiết đứng ngay sau dấu này đọc to, cao và dài hơn.' },
    { s: 'ˌ', tip: 'Trọng âm phụ: nhấn nhẹ hơn trọng âm chính.' },
    { s: 'ː', tip: 'Kéo dài nguyên âm đứng trước.' },
    { s: '.', tip: 'Dấu chấm (Cambridge) ngăn cách các âm tiết.' },
    { s: '(r)', tip: 'Chữ r trong ngoặc / chữ nhỏ: giọng Anh chỉ đọc khi từ sau bắt đầu bằng nguyên âm.' },
  ];

  const all = groups.flatMap((g) => g.items.map((x) => ({ ...x, group: g.key })));
  const bySymbol = new Map();
  for (const x of all) if (!bySymbol.has(x.s)) bySymbol.set(x.s, x);
  // Ký hiệu biến thể quy về ký hiệu chuẩn
  const aliases = { ɹ: 'r', g: 'ɡ', ɛ: 'e', ɔ: 'ɔː', ɑ: 'ɑː', ɾ: 't̬', ʤ: 'dʒ', ʧ: 'tʃ', ɐ: 'ʌ', ɫ: 'l', ʔ: 't' };
  const symbols = [...bySymbol.keys(), ...Object.keys(aliases)].sort((a, b) => b.length - a.length);
  const vowelGroups = new Set(['short', 'long', 'diph']);

  /** Tách phiên âm thành các âm, ví dụ "/əˈbæn.dən/" → [ə, ˈ, b, æ, n, ., d, ə, n] */
  function tokenize(ipa) {
    const src = String(ipa || '').replace(/[\/\[\]]/g, '').replace(/ʳ/g, '(r)').normalize('NFC');
    const out = [];
    let i = 0;
    while (i < src.length) {
      if (src.startsWith('(r)', i)) {
        out.push({ s: '(r)', mark: true });
        i += 3;
        continue;
      }
      const ch = src[i];
      if ('ˈˌ.'.includes(ch)) {
        out.push({ s: ch, mark: true });
        i++;
        continue;
      }
      if (ch === ' ') {
        out.push({ s: ' ', mark: true });
        i++;
        continue;
      }
      const sym = symbols.find((x) => src.startsWith(x, i));
      if (sym) {
        const canon = aliases[sym] || sym;
        // Gộp ký hiệu kéo dài (ː) nếu chưa nằm trong ký hiệu
        out.push({ s: sym, info: bySymbol.get(canon) || null });
        i += sym.length;
      } else {
        if (ch === 'ː' && out.length) out[out.length - 1].s += 'ː';
        else if (!/[̀-ͯ]/.test(ch)) out.push({ s: ch, info: null });
        i++;
      }
    }
    return out;
  }

  return { groups, marks, tokenize, bySymbol, isVowel: (x) => x && vowelGroups.has(x.group) };
})();
