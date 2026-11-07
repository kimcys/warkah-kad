// The text of the privacy notice (/privasi) and the terms (/terma), in Bahasa Malaysia. English comes later with the rest of the English text
// (Malaysia's PDPA expects a privacy notice in both languages, so add it before launch).
// Each page is { title, intro, sections: [{ id, h, p?: string[], ul?: string[] }] }. It describes what Warkah Kad really does.
//
// DRAFT: written from how the product works, not by a lawyer. The owner must confirm the points marked CONFIRM below and have the text reviewed
// before the service is opened to the public.
//   CONFIRM: where guests' RSVPs, wishes and gifts are kept (the engine sends them to the shared Warkah project under events/<slug>, a Google Firebase
//            project) and for how long; the company details to show; the refund rule; the prices (none are stated here).

export const LEGAL_UPDATED_LABEL = "7 November 2026";

export const LEGAL = {
  privacy: {
    title: "Notis Privasi",
    intro: "Notis ini menerangkan data peribadi yang dikumpul oleh Warkah Kad, kenapa kami mengumpulnya, dan apa yang anda boleh lakukan mengenainya. Ia diberikan menurut Akta Perlindungan Data Peribadi 2010 (PDPA) Malaysia.",
    sections: [
      { id: "kami", h: "1. Siapa kami", p: ["Warkah Kad ialah perkhidmatan untuk membina kad kahwin digital, dikendalikan oleh Warkah (pengasas: Aiman Hakim), Malaysia. Untuk soalan atau permintaan mengenai data anda, hubungi kami di WhatsApp 017-265 5375."] },
      { id: "kumpul", h: "2. Data yang kami kumpul", p: ["Daripada pelanggan (pembina kad):"],
        ul: ["E-mel anda, untuk log masuk (kami menghantar kod 6 digit, tiada kata laluan).",
          "Apa yang anda taip dan muat naik ke dalam kad: nama pengantin dan ibu bapa, tarikh, tempat dan alamat majlis, pautan peta, nama dan nombor telefon orang untuk dihubungi, atur cara, senarai hadiah, ayat, gambar (muka depan, potret, galeri, hadiah), kod QR DuitNow, dan lagu latar.",
          "Pilihan anda: tema, warna, model pengantin, pakej, dan alamat kad."] },
      { id: "tetamu", h: "", p: ["Daripada tetamu yang membuka kad yang diterbitkan (tanpa akaun):"],
        ul: ["Apa yang mereka pilih untuk hantar melalui kad, seperti RSVP, ucapan dan hadiah. Ini disimpan untuk pemilik kad."] },
      { id: "teknikal", h: "", p: ["Data teknikal:"],
        ul: ["Alamat IP anda, digunakan seketika untuk menghalang penyalahgunaan (had kekerapan). Rekod ini dipadam dalam masa 2 hari.",
          "Halaman ini memuatkan fon daripada Google Fonts, jadi Google menerima alamat IP anda semasa memuatkannya.",
          "Kami tidak menggunakan kuki pengiklanan atau penjejakan."] },
      { id: "guna", h: "3. Kenapa kami menggunakannya", ul: ["Menyediakan perkhidmatan: log masuk, menyimpan draf anda, membina pratonton dan kad yang diterbitkan.", "Menghantar kod log masuk.", "Mengaktifkan kad selepas pembayaran diterima, dan menjawab pertanyaan anda.", "Menghalang penyalahgunaan dan menjaga keselamatan perkhidmatan."] },
      { id: "siapa", h: "4. Siapa boleh melihat kad anda", ul: ["Draf anda hanya boleh dilihat oleh anda.", "Pratonton boleh dilihat oleh sesiapa yang mempunyai pautan pratonton, sehingga tujuh hari selepas dibina. Pautan itu tidak muncul di Google.", "Kad yang diterbitkan boleh dilihat oleh sesiapa yang mempunyai pautannya. Ia tidak dimasukkan dalam carian Google, tetapi sesiapa yang menerima pautan boleh berkongsinya. Anda boleh menarik balik kad pada bila-bila masa."] },
      { id: "pihak", h: "5. Pendedahan kepada pihak lain", p: ["Kami tidak menjual data anda. Kami menggunakan penyedia perkhidmatan untuk menjalankan perkhidmatan ini:"],
        ul: ["Cloudflare: pengehosan, pangkalan data dan storan fail.", "Resend: penghantaran e-mel (kod log masuk).", "Google Fonts: fon halaman.", "Google (Firebase): penyimpanan RSVP, ucapan dan hadiah yang dihantar tetamu melalui kad yang diterbitkan.", "Pihak berkuasa, jika dikehendaki oleh undang-undang."] },
      { id: "luar", h: "", p: ["Penyedia ini mungkin memproses data di luar Malaysia. Kami hanya menggunakan penyedia yang menyediakan perlindungan yang munasabah."] },
      { id: "kuki", h: "6. Kuki dan storan pada peranti", ul: ["Kuki sesi (__Host-session): hanya untuk pelanggan yang log masuk, bertahan sehingga 30 hari, digunakan untuk mengekalkan log masuk anda."] },
      { id: "simpan", h: "7. Berapa lama kami menyimpannya", ul: ["Draf yang tidak disentuh selama 90 hari diarkibkan, dan butiran serta fail di dalamnya dipadam.", "Pratonton dipadam tujuh hari selepas dibina.", "Kad yang diterbitkan kekal sehingga anda menarik baliknya atau meminta ia dipadam. Apabila ditarik balik, failnya dipadam serta-merta.", "Kod log masuk dipadam dalam masa sehari selepas tamat tempoh; sesi tamat selepas 30 hari."] },
      { id: "selamat", h: "8. Keselamatan", p: ["Sambungan menggunakan HTTPS. Akses kepada draf disemak oleh pelayan, kuki sesi tidak boleh dibaca oleh skrip halaman, dan kod log masuk disimpan dalam bentuk yang tidak boleh dibaca semula. Tiada sistem yang selamat sepenuhnya, tetapi kami mengambil langkah yang munasabah."] },
      { id: "hak", h: "9. Hak anda", p: ["Anda boleh meminta untuk mengakses, membetulkan atau memadam data peribadi anda, atau menarik balik persetujuan. Hubungi kami di WhatsApp 017-265 5375 dan nyatakan e-mel akaun serta alamat kad anda. Kami mungkin perlu mengesahkan identiti anda."] },
      { id: "orang", h: "10. Data orang lain dalam kad anda", p: ["Kad anda mengandungi nama, gambar dan nombor telefon orang lain (keluarga, orang untuk dihubungi). Anda bertanggungjawab mendapatkan kebenaran mereka sebelum memasukkannya. Perkhidmatan ini tidak ditujukan kepada kanak-kanak; jika anda memasukkan gambar atau butiran kanak-kanak, dapatkan kebenaran ibu bapa atau penjaga."] },
      { id: "ubah", h: "11. Perubahan notis ini", p: ["Kami boleh mengemas kini notis ini. Tarikh kemas kini terkini ditunjukkan di atas."] }
    ]
  },
  terms: {
    title: "Terma Perkhidmatan",
    intro: "Terma ini terpakai apabila anda menggunakan Warkah Kad. Dengan menggunakan perkhidmatan ini anda bersetuju dengan terma ini dan Notis Privasi kami.",
    sections: [
      { id: "khidmat", h: "1. Perkhidmatan", p: ["Warkah Kad membolehkan anda membina kad kahwin digital: memilih tema, mengisi butiran, melihat pratonton kad anda sendiri, dan menerbitkannya pada satu alamat web yang boleh dikongsi. Ciri bergantung pada pakej yang anda pilih."] },
      { id: "akaun", h: "2. Akaun anda", ul: ["Log masuk menggunakan kod yang dihantar ke e-mel anda. Anda bertanggungjawab ke atas e-mel dan peranti anda.", "Berikan maklumat yang betul. Satu akaun boleh mempunyai sehingga 3 kad draf.", "Akaun adalah untuk anda sahaja dan tidak boleh dikongsi atau dipindahkan tanpa kebenaran kami."] },
      { id: "kandungan", h: "3. Kandungan anda", ul: ["Anda kekal memiliki kandungan yang anda muat naik dan taip. Anda memberi Warkah kebenaran untuk menyimpan, memprosesnya, membina kad anda, dan memaparkannya di alamat kad anda, hanya bagi menjalankan perkhidmatan ini.", "Anda memastikan anda berhak menggunakan setiap gambar, lagu dan teks yang anda masukkan, dan mendapat kebenaran orang yang disebut atau kelihatan dalam kad anda.", "Jangan memasukkan kandungan yang menyalahi undang-undang, mengelirukan, menyinggung atau menyalahgunakan hak orang lain. Kami boleh mengalih keluar kandungan atau kad yang melanggar terma ini."] },
      { id: "terbit", h: "4. Pratonton dan menerbitkan", ul: ["Anda mesti melihat pratonton kad anda sendiri sebelum menerbitkannya. Menerbitkan membuat kad boleh dilihat oleh sesiapa yang mempunyai pautannya.", "Anda boleh menarik balik kad pada bila-bila masa. Selepas itu alamatnya tidak lagi menunjukkan kad dan failnya dipadam.", "Anda boleh mengubah kad yang diterbitkan dan menerbitkannya semula; alamat kad kekal sama. Alamat tidak boleh diubah selepas diterbitkan."] },
      { id: "harga", h: "5. Pakej dan bayaran", ul: ["Membina dan melihat pratonton tidak dikenakan bayaran. Bayaran dikenakan untuk menerbitkan, mengikut pakej yang anda pilih.", "Buat masa ini bayaran dibuat melalui WhatsApp dan pindahan bank. Kami mengaktifkan kad anda selepas bayaran diterima.", "Harga dimaklumkan oleh kami sebelum anda membayar."] },
      { id: "bayar", h: "6. Bayaran balik", p: ["Jika ada masalah dengan pesanan anda, hubungi kami. Kami menilai setiap permintaan bayaran balik secara adil mengikut keadaan, termasuk sama ada kad telah diterbitkan."] },
      { id: "guna", h: "7. Penggunaan yang dibenarkan", p: ["Jangan mengganggu atau cuba merosakkan perkhidmatan, mengakses data orang lain, menggunakan perkhidmatan secara automatik atau berlebihan, atau menyalahgunakan alamat dan pautan. Kami boleh mengehadkan atau menggantung akses yang menyalahgunakan perkhidmatan."] },
      { id: "sedia", h: "8. Ketersediaan", p: ["Kami berusaha agar perkhidmatan berjalan dengan baik, tetapi ia disediakan sebagaimana adanya dan tanpa jaminan tiada gangguan atau ralat. Ciri boleh diubah atau ditambah. Simpan salinan gambar dan teks asal anda sendiri."] },
      { id: "liabiliti", h: "9. Had liabiliti", p: ["Setakat yang dibenarkan oleh undang-undang, Warkah tidak bertanggungjawab atas kerugian tidak langsung atau berbangkit. Jumlah tanggungjawab kami berkaitan sesuatu kad tidak melebihi jumlah yang anda bayar untuk kad itu."] },
      { id: "tamat", h: "10. Penamatan", p: ["Anda boleh berhenti menggunakan perkhidmatan pada bila-bila masa dan meminta akaun dipadam. Kami boleh menggantung atau menamatkan akses jika terma ini dilanggar."] },
      { id: "undang", h: "11. Undang-undang", p: ["Terma ini ditadbir oleh undang-undang Malaysia dan mahkamah Malaysia mempunyai bidang kuasa."] },
      { id: "ubah", h: "12. Perubahan dan hubungi kami", p: ["Kami boleh mengemas kini terma ini; tarikh terkini ditunjukkan di atas dan penggunaan berterusan bermaksud anda bersetuju. Hubungi kami di WhatsApp 017-265 5375."] }
    ]
  }
};
