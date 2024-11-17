"use strict";

const fs = require("fs");
const { execSync } = require("child_process");
const axios = require("axios");
const { OpenAI } = require("openai");
const os = require("os");
const notifier = require("node-notifier");

// 通知音のリストとデフォルト設定
const notificationSounds = ["Glass", "Ping", "Basso", "Funk", "Submarine"];
let workPeriodSound = "Glass";
let breakPeriodSound = "Funk";
let startSound = "Ping";
let exitSound = "Basso"; // OSごとの通知モジュール

const VV_ENDPOINT = "http://localhost:50021";

// OpenAI API設定
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// コマンドライン引数の処理
const args = process.argv.slice(2);
const isTestMode = args.includes("test");

// 使用時間の指定（分単位）、未指定の場合はエンドレス
const usageTimeArg = args.find(arg => arg.startsWith("usageTime="))?.split("=")[1];
const usageTime = usageTimeArg ? parseInt(usageTimeArg, 10) * 60 * 1000 : null; // 分をミリ秒に変換

// アプリの開始時刻
const startTime = Date.now();

// 経過時間をフォーマットする関数
function getElapsedTime() {
  const elapsedMilliseconds = Date.now() - startTime;
  const elapsedSeconds = Math.floor((elapsedMilliseconds / 1000) % 60);
  const elapsedMinutes = Math.floor((elapsedMilliseconds / (1000 * 60)) % 60);
  const elapsedHours = Math.floor((elapsedMilliseconds / (1000 * 60 * 60)));
  return `${elapsedHours}時間${elapsedMinutes}分${elapsedSeconds}秒`;
}

// システムプロンプトの各パーツ
const systemPromptIntro = "あなたは、優しくてかわいいずんだもちの妖精である「ずんだもん」として振る舞います。続く条件に厳密に従ってください。";

const systemPromptConditions = `条件：
- あなたの一人称は「ぼく」です。
- あなたの名前は「ずんだもん」です。
- ずんだもんはフレンドリーな口調で話します。
- できる限り「〜のだ」「〜なのだ」を文末に自然な形で使ってください。
- 日本語で応答してください。`;

const systemPromptGuidelines = `ずんだもんの行動方針：
- 自己紹介はしません。
- ユーザとの対話はしません。
- ずんだもんはポモドーロタイマーのナレーターとして、多様な言い回しでユーザーに休憩を促す役割を担っています。
- ナレーションの内容は2~3文にしてください。
- 次の文章の内容についてナレーションに取り入れてください。`;

const userName = args.find(arg => arg.startsWith("name="))?.split("=")[1] || "ユーザ";
const systemPromptUserInfo = `ユーザ情報：
- 名前は${userName}です。`;

// ポモドーロメッセージ生成関数
async function generateVoiceMessage(isWorkPeriod) {
  const elapsedTime = getElapsedTime();
  const rawPrompt = isWorkPeriod
    ? `作業時間が始まります。${userName}さん、${workSessionCount}回目の作業です。${elapsedTime}経過しました。${usageTime ? '残り' + Math.max(0, Math.floor((usageTime - (Date.now() - startTime)) / (60 * 1000))) + '分です。' : ''}`
    : `休憩時間です。${userName}さん、${breakSessionCount}回目の休憩です。${elapsedTime}経過しました。${usageTime ? '残り' + Math.max(0, Math.floor((usageTime - (Date.now() - startTime)) / (60 * 1000))) + '分です。' : ''}`;
  const userPrompt = "日本語で、回答してください。改行せずに回答してください。次の文章は設定通りのセリフを回答の冒頭に追加してください。";
  const systemPrompt = `${systemPromptIntro}
${systemPromptConditions}
${systemPromptGuidelines}
${systemPromptUserInfo}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${userPrompt}${rawPrompt}` },
      ],
    });
    return completion.choices[0].message.content;
  } catch (apiError) {
    console.error(`[${getElapsedTime()}][OpenAI APIエラー] ${apiError.message}`);
    return rawPrompt; // エラー時は元のプロンプトを使用
  }
}

// 音声合成と再生関数
async function synthesizeAndPlayVoice(text) {
  try {
    console.log(`[${getElapsedTime()}][VOICEVOX] クエリを送信中...`);
    const queryRes = await axios.post(`${VV_ENDPOINT}/audio_query?speaker=3&text=${encodeURIComponent(text)}`);
    console.log(`[${getElapsedTime()}][VOICEVOX] クエリ作成に成功しました。音声合成を開始します...`);
    // 音声合成前に通知を表示
    showNotification("ポモドーロタイマー", text, isWorkPeriod ? workPeriodSound : breakPeriodSound);
    const synthesisResponse = await axios.post(`${VV_ENDPOINT}/synthesis?speaker=3`, queryRes.data, {
      responseType: "arraybuffer",
    });
    console.log(`[${getElapsedTime()}][VOICEVOX] 音声合成完了、ファイルに書き込み中...`);
    fs.writeFileSync("/tmp/pomodoro_voice.wav", synthesisResponse.data);
    console.log(`[${getElapsedTime()}][VOICEVOX] 音声再生実行。`);
    const platform = os.platform();
    if (platform === 'darwin') {
        execSync("afplay /tmp/pomodoro_voice.wav");
    } else if (platform === 'win32') {
        execSync("powershell -c (New-Object Media.SoundPlayer '/tmp/pomodoro_voice.wav').PlaySync();");
    } else if (platform === 'linux') {
        execSync("aplay /tmp/pomodoro_voice.wav");
    } // 音声を再生
    console.log(`[${getElapsedTime()}][VOICEVOX] 音声再生完了。`);
  } catch (error) {
    console.error(`[${getElapsedTime()}][VOICEVOX 音声合成エラー] ${error.message}`);
  }
}

// 通知を表示する関数
function showNotification(title, message, sound) {
    sound = getPlatformSpecificSound(sound);
  notifier.notify({
    title: title,
    message: message,
    sound: getPlatformSpecificSound(sound), // OSの通知音を再生
    wait: false, // ユーザーが通知を閉じるのを待たない
  });
}

// アプリ起動時のメッセージ再生と通知
(async () => {
  const startMessage = "ずんだもんによるポモドーロタイマーアプリ、起動します";
  showNotification("ポモドーロタイマー起動", startMessage, startSound);
  await synthesizeAndPlayVoice(startMessage);
})();

// ポモドーロタイマー設定
let appTimeout;
if (usageTime) {
  appTimeout = setTimeout(() => {
    const exitMessage = "ずんだもんによるポモドーロタイマーアプリ、指定された時間で終了します";
    showNotification("ポモドーロタイマー終了", exitMessage, exitSound);
    synthesizeAndPlayVoice(exitMessage).then(() => process.exit());
  }, usageTime);
}
let isWorkPeriod = true;
let workSessionCount = 1;
let breakSessionCount = 1;
const workDuration = isTestMode ? 60000 : 1500000; // テストモードでは1分、通常は25分
const breakDuration = isTestMode ? 30000 : 300000; // テストモードでは30秒、通常は5分

setInterval(async () => {
  const enhancedPrompt = await generateVoiceMessage(isWorkPeriod);
  console.log(`[${getElapsedTime()}][生成されたプロンプト (gpt-4o-mini)] ${enhancedPrompt}`);
  await synthesizeAndPlayVoice(enhancedPrompt);

  const notificationTitle = isWorkPeriod ? "作業開始" : "休憩開始";
  const notificationMessage = isWorkPeriod
    ? `${userName}さん、${workSessionCount}回目の作業を開始します。`
    : `${userName}さん、${breakSessionCount}回目の休憩を開始します。`;
  showNotification(notificationTitle, notificationMessage);

  isWorkPeriod = !isWorkPeriod;
  if (isWorkPeriod) {
    workSessionCount++;
  } else {
    breakSessionCount++;
  }
}, isWorkPeriod ? workDuration : breakDuration);

// プロセス終了時のメッセージ再生と通知
process.on("SIGINT", async () => {
  const exitMessage = "ずんだもんによるポモドーロタイマーアプリ、終了します";
  showNotification("ポモドーロタイマー終了", exitMessage, exitSound);
  await synthesizeAndPlayVoice(exitMessage);
  process.exit();
});

// OSごとの通知音を取得する関数
function getPlatformSpecificSound(sound) {
    const platform = os.platform();
    switch (platform) {
        case 'darwin':
            return sound; // macOSでは指定したサウンドをそのまま使用
        case 'win32':
            return null; // Windowsはカスタムサウンドをサポートしない場合が多いため、デフォルトを使用
        case 'linux':
            return null; // Linuxは通知音のサポートが環境によって異なるため、デフォルトを使用
        default:
            return null; // その他のプラットフォームではデフォルト通知音を使用
    }
}

// 非推奨警告を無効化
process.env.NODE_NO_WARNINGS = "1";
