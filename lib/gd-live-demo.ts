export type LiveSpeaker = '自分' | '他者';

export type DemoLine = {
  atSec: number;
  speaker: LiveSpeaker;
  text: string;
};

/** Wall-clock length of one dummy GD. Speech ends just before this. */
export const GD_LIVE_DURATION_MS = 12 * 60 * 1000;

/** Vertical scale. One minute is this many pixels, so silence stays blank. */
export const GD_PX_PER_SEC = 11;

/** Self-lane blanks shorter than this stay uncolored. */
export const GD_SILENCE_MS = 48_000;

/** Card cap. Taller text clips and shows the edge warning. */
export const GD_MAX_CARD_PX = 210;

/**
 * Dummy GD. Beats, in session seconds:
 * - 0–99 back-and-forth
 * - 99–278 self silence while others keep talking (long text at 168s)
 * - 372–473 self monologue (long text at 410s)
 * - 488–710 back-and-forth close
 * No audio. Times are seconds from 開始.
 */
export const GD_DEMO_LINES: DemoLine[] = [
  { atSec: 0, speaker: "他者", text: "まず、誰の話か揃えませんか。地方の大学に通う学生です。" },
  { atSec: 8, speaker: "自分", text: "賛成です。東京のイベントに、行くべきかを今日決めたい。" },
  { atSec: 17, speaker: "他者", text: "行く前に、行けない理由を三つだけ挙げたいです。" },
  { atSec: 27, speaker: "自分", text: "お金、時間、ひとりで不安。この三つで足りると思います。" },
  { atSec: 39, speaker: "他者", text: "お金は往復の交通費。時間は土曜の半日。不安は集合が分からないこと。" },
  { atSec: 52, speaker: "自分", text: "その不安は、ガイドがあればかなり減らせそうです。" },
  { atSec: 64, speaker: "他者", text: "減らせるのは場所の不安だけ、という切り分けが大事です。" },
  { atSec: 76, speaker: "自分", text: "では前提は、人は行きたい。止まっているのは手順です。" },
  { atSec: 88, speaker: "他者", text: "同意です。意欲がない人を説得する話にはしない。" },
  { atSec: 99, speaker: "自分", text: "前提はそこで一度止めましょう。" },
  { atSec: 116, speaker: "他者", text: "ターゲットは、サークルに入ったばかりの一年生に絞りたいです。" },
  { atSec: 133, speaker: "他者", text: "二年生はもう友人と動ける。一年生の最初の学期が境目です。" },
  { atSec: 151, speaker: "他者", text: "社会人の講座と混ぜると、値段も時間の感覚もずれます。" },
  { atSec: 168, speaker: "他者", text: "地方から上京したばかりの学生と、ずっと地元にいる学生では、東京の駅で迷う怖さが違います。今日の対象は迷う方です。乗り換えを何度も検索して、それでも改札の柱が分からず足が止まる。案内は、その足が止まる直前に届いていないと意味がありません。検索結果の一覧を渡すだけでは、人混みの中では読めません。柱の色、出口の番号、改札の名前まで書いて、初めて当日の足が動きます。" },
  { atSec: 177, speaker: "他者", text: "迷う人向け、でいいですね。短い一文に戻します。" },
  { atSec: 195, speaker: "他者", text: "予算の体感は、ランチを一回我慢するくらい。往復五千円です。" },
  { atSec: 214, speaker: "他者", text: "五千円を超えるイベントは、今回の結論から外しましょう。" },
  { atSec: 234, speaker: "他者", text: "先輩が誘えば行く、という声は多いです。でも必須にすると先輩が先に疲れます。" },
  { atSec: 254, speaker: "他者", text: "だから同行は募集だけ。行かない自由を残します。" },
  { atSec: 278, speaker: "自分", text: "戻ります。先輩必須は重い、という意見に賛成です。" },
  { atSec: 290, speaker: "他者", text: "おかえりなさい。いまの着地は、同行は任意です。" },
  { atSec: 302, speaker: "自分", text: "任意の募集と、ひとり向けの手順。二本立てがよさそうです。" },
  { atSec: 315, speaker: "他者", text: "手順は紙のチラシですか。" },
  { atSec: 324, speaker: "自分", text: "スマホで見られる三行がいいです。印刷は負けです。" },
  { atSec: 336, speaker: "他者", text: "三行なら、当日の朝でも読めます。" },
  { atSec: 347, speaker: "自分", text: "名前は「ひとり出発ガイド」。短いほうが渡しやすい。" },
  { atSec: 359, speaker: "他者", text: "いい名前です。では中身を、あなたの番で聞かせてください。" },
  { atSec: 372, speaker: "自分", text: "渡すのは新歓の翌日、サークルの連絡帳です。" },
  { atSec: 384, speaker: "自分", text: "読み手は朝の電車です。スクロールが要る長さは失敗です。" },
  { atSec: 397, speaker: "自分", text: "一行目は、家を出る時刻と乗換だけ。景色の話は書きません。" },
  { atSec: 410, speaker: "自分", text: "二行目は集合です。駅名だけではなく、改札を出て何歩目の柱か、何番出口のどの看板の前かまで書きます。ここが曖昧だと、五千円を払って東京まで来た人が人混みの中で友達に何度も電話することになります。写真は当日の朝に撮れないので、言葉で柱を一本に決めます。検索のリンクも、この一行には置きません。リンクは電波の悪い改札の下では開かず、開いても地図のピンが大きすぎて柱は分かりません。" },
  { atSec: 419, speaker: "自分", text: "三行目は帰りです。何時までに、この改札へ戻るか。" },
  { atSec: 432, speaker: "自分", text: "泊まる場所までは書かない。判断の時刻だけ書きます。" },
  { atSec: 445, speaker: "自分", text: "追加したくなったら別の紙です。ガイド自体は三行で止めます。" },
  { atSec: 459, speaker: "自分", text: "通知を開いた最初の画面に、三行が収まっている想定です。" },
  { atSec: 473, speaker: "自分", text: "以上が、ひとりで当日を終わらせるための中身です。" },
  { atSec: 488, speaker: "他者", text: "長いあいだ、ありがとうございました。柱の指定は残したいです。" },
  { atSec: 501, speaker: "自分", text: "残します。写真はなくて、言葉だけで柱を指定します。" },
  { atSec: 514, speaker: "他者", text: "言葉だけなら、当日に更新しやすいですね。" },
  { atSec: 526, speaker: "自分", text: "終電の一行は安全の話なので、削りません。" },
  { atSec: 538, speaker: "他者", text: "削らないでください。それがガイドの最後の一行です。" },
  { atSec: 550, speaker: "自分", text: "では三行で固定します。" },
  { atSec: 563, speaker: "他者", text: "目指す結論を、お題に戻って一文にしませんか。" },
  { atSec: 576, speaker: "自分", text: "一年生が、往復五千円以内で、ひとりでも当日動ける案内を渡す。" },
  { atSec: 590, speaker: "他者", text: "渡す日は新歓の翌日。渡す人はサークルの幹事。" },
  { atSec: 603, speaker: "自分", text: "幹事が忙しい週なら、文章だけ先にチャットへ流す。" },
  { atSec: 617, speaker: "他者", text: "チャットは流れて消えます。固定メッセージに残したいです。" },
  { atSec: 630, speaker: "自分", text: "固定で同意です。当日の朝に、もう一度同じ三行を載せます。" },
  { atSec: 644, speaker: "他者", text: "反対は、現地の受け入れがいない、という点です。" },
  { atSec: 657, speaker: "自分", text: "受け入れは必須にしない。知り合いがいたら一声、まで。" },
  { atSec: 670, speaker: "他者", text: "一声までなら、負担は小さいです。" },
  { atSec: 683, speaker: "自分", text: "結論は、三行のガイドを固定して渡す。同行は任意。" },
  { atSec: 697, speaker: "他者", text: "お題への答えとして、足りていると思います。" },
  { atSec: 710, speaker: "自分", text: "今日はここまで決め切れてよかった。次は文章を書く回です。" },
];
