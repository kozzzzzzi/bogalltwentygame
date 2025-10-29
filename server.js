const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// 프론트에서 접근 허용할 도메인들
const ALLOWED_ORIGINS = [
  "https://oopp.kr",
  "http://oopp.kr",
  "http://localhost:3000",
  "http://localhost:5173"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Render의 헬스체크나 같은-origin 호출은 origin이 빈값일 수도 있다.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS blocked: " + origin));
      }
    }
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  }
});

/*
rooms[roomCode] = {
  word: "정답 단어",
  wordLocked: true,
  hostId: "socketId",
  hostName: "닉",
  guessers: [ {id, name}, ... ],
  chat: [],
  lastQuestionId: 0,
  questionCount: 0,
  waitingForAnswer: 0 | null,
  gameOver: false,
  gameResultForHost: null,      // "hostWin" | "hostLose"
  gameResultForGuesser: null,   // "guesserWin" | "guesserLose"
  finalWordShown: false
};
*/
const rooms = {};

// ====== 유틸: 게임 종료 ======
function endGameGuesserLose(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostWin";
  room.gameResultForGuesser = "guesserLose";
  room.finalWordShown = true;
}

function endGameGuesserWin(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostLose";
  room.gameResultForGuesser = "guesserWin";
  room.finalWordShown = true;
}

function cleanupRoom(roomCode) {
  delete rooms[roomCode];
}

// ====== 유틸: 한글 초성 추출 ======
function computeChosung(word) {
  if (!word || typeof word !== "string") return "?";

  const CHO_LIST = [
    "ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ",
    "ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"
  ];

  let result = [];
  for (const ch of word) {
    const code = ch.charCodeAt(0);
    // 한글 범위 가~힣: 0xAC00 ~ 0xD7A3
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      const choIndex = Math.floor(offset / (21 * 28));
      result.push(CHO_LIST[choIndex] || ch);
    } else {
      // 한글 완성형 아니면 그냥 원문 넣는다.
      result.push(ch);
    }
  }
  return result.join("");
}

// ====== 방 참가자 목록 브로드캐스트 ======
function emitPlayers(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("playersUpdate", {
    hostId: room.hostId,
    hostName: room.hostName,
    guessers: room.guessers || []
  });
}

// ====== 방의 전체 상태(채팅/질문수 등) 브로드캐스트 ======
function emitRoomChatState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("chatUpdate", {
    items: room.chat,
    questionCount: room.questionCount,
    waitingForAnswer: room.waitingForAnswer,
    wordLocked: room.wordLocked,
    gameOver: room.gameOver,
    gameResultForHost: room.gameResultForHost,
    gameResultForGuesser: room.gameResultForGuesser,
    finalWord: room.finalWordShown ? room.word : undefined
  });
}

io.on("connection", (socket) => {
  // 출제자: 방 만들기
  // client emits: { roomCode, nickname, word }
  socket.on("createRoom", ({ roomCode, nickname, word }) => {
    if (!roomCode) {
      socket.emit("errorMsg", "방 코드를 입력하세요.");
      return;
    }
    if (!nickname || !nickname.trim()) {
      socket.emit("errorMsg", "닉네임을 입력하세요.");
      return;
    }
    if (!word || !word.trim()) {
      socket.emit("errorMsg", "정답 단어를 입력하세요.");
      return;
    }
    if (rooms[roomCode]) {
      socket.emit("errorMsg", "이미 존재하는 방 코드입니다.");
      return;
    }

    const finalWord = word.trim();

    rooms[roomCode] = {
      word: finalWord,
      wordLocked: true, // 방 만들자마자 잠금
      hostId: socket.id,
      hostName: nickname.trim() || "출제자",
      guessers: [],

      chat: [],
      lastQuestionId: 0,
      questionCount: 0,
      waitingForAnswer: null,

      gameOver: false,
      gameResultForHost: null,
      gameResultForGuesser: null,
      finalWordShown: false
    };

    socket.join(roomCode);

    // 출제자에게만 정답 단어 전달
    socket.emit("roomJoined", {
      role: "host",
      roomCode,
      word: finalWord,          // 정답 단어
      wordLocked: true,         // 이미 잠금
      questionCount: 0,
      waitingForAnswer: null,
      gameOver: false,
      gameResultForHost: null,
      gameResultForGuesser: null,
      finalWord: undefined
    });

    // 참가자 목록/상태 브로드캐스트
    emitPlayers(roomCode);
    emitRoomChatState(roomCode);
  });

  // 참가자: 방 참여
  socket.on("joinRoom", ({ roomCode, nickname }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("errorMsg", "존재하지 않는 방 코드입니다.");
      return;
    }

    socket.join(roomCode);

    if (!room.guessers.find((g) => g.id === socket.id)) {
      room.guessers.push({
        id: socket.id,
        name: nickname || "참가자"
      });
    }

    socket.emit("roomJoined", {
      role: socket.id === room.hostId ? "host" : "guesser",
      roomCode,
      word: socket.id === room.hostId ? room.word : undefined, // 출제자만 단어 전체를 본다
      wordLocked: room.wordLocked, // 참가자도 true 받으므로 질문 가능
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 현재 채팅/상태 전송
    emitRoomChatState(roomCode);

    // 참가자 목록 브로드캐스트
    emitPlayers(roomCode);
  });

  // 출제자: 단어 설정 (예전 방식 - 이제는 안 써도 되지만 남겨둠. 이미 잠겨있으면 무시)
  socket.on("setWord", ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.wordLocked) return;
    if (!word || !word.trim()) return;

    room.word = word.trim();
    room.wordLocked = true;

    // 모두에게 상태 전송 (단어 자체는 숨김)
    io.to(roomCode).emit("roomState", {
      role: null,
      roomCode,
      word: undefined,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 출제자에게만 정답 단어 포함
    io.to(room.hostId).emit("roomState", {
      role: "host",
      roomCode,
      word: room.word,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });
  });

  // 출제자: 힌트 전송 (수동 힌트 + /똥 이펙트)
  socket.on("sendHint", ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (!text || !text.trim()) return;

    const trimmed = text.trim();

    // 특수 이펙트 커맨드
    if (trimmed === "/똥") {
      // 이펙트 트리거만 쏨. 채팅 로그에는 안 남김.
      io.to(roomCode).emit("effect", { type: "poopRain" });
      return;
    }

    // 일반 힌트
    const hintMsg = {
      type: "hint",
      from: room.hostName || "출제자",
      text: trimmed
    };
    room.chat.push(hintMsg);

    io.to(roomCode).emit("newHint", hintMsg);
    emitRoomChatState(roomCode);
  });

  // 참가자: 질문 전송
  socket.on("askQuestion", ({ roomCode, text, nickname }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.gameOver) return;
    if (!text || !text.trim()) return;

    // 출제자는 질문 불가
    if (socket.id === room.hostId) return;

    // 단어 설정 전이면 질문 불가
    if (!room.wordLocked || !room.word) return;

    // 이전 질문 답변 대기 중이면 불가
    if (room.waitingForAnswer) return;

    room.lastQuestionId += 1;
    room.questionCount += 1;

    let askerName = nickname;
    if (!askerName) {
      const g = room.guessers.find((gg) => gg.id === socket.id);
      askerName = g ? g.name : "참가자";
    }

    const q = {
      type: "q",
      id: room.lastQuestionId,
      from: askerName,
      text: text.trim()
    };

    room.chat.push(q);
    room.waitingForAnswer = q.id;

    io.to(roomCode).emit("newQuestion", {
      ...q,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    emitRoomChatState(roomCode);
  });

  // 출제자: 질문에 답변
  socket.on("answerQuestion", ({ roomCode, questionId, kind }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.gameOver) return;
    if (room.waitingForAnswer !== questionId) return;

    const a = {
      type: "a",
      qid: questionId,
      from: room.hostName || "출제자",
      kind // "yes" | "no" | "idk" | "correct"
    };
    room.chat.push(a);

    // 정답 맞춘 경우 → 참가자 승리
    if (kind === "correct") {
      endGameGuesserWin(room);

      io.to(roomCode).emit("newAnswer", {
        ...a,
        questionCount: room.questionCount,
        waitingForAnswer: null,
        wordLocked: room.wordLocked,
        gameOver: room.gameOver,
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      io.to(roomCode).emit("gameOver", {
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      // 방 삭제
      return;
    }

    // 정답 아닌 경우 → 다음 질문 가능
    room.waitingForAnswer = null;

    // 질문 20개 이상 → 참가자 패배
    if (room.questionCount >= 20) {
      endGameGuesserLose(room);

      io.to(roomCode).emit("newAnswer", {
        ...a,
        questionCount: room.questionCount,
        waitingForAnswer: room.waitingForAnswer, // null
        wordLocked: room.wordLocked,
        gameOver: room.gameOver,
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      io.to(roomCode).emit("gameOver", {
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      return;
    }

    // 여기까지 왔으면 게임은 아직 진행 중
    io.to(roomCode).emit("newAnswer", {
      ...a,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // ====== 자동 힌트 로직 ======
    if (!room.gameOver && room.word && room.wordLocked) {
      // 10번째 질문: 글자수 힌트
      if (room.questionCount === 10) {
        const len = room.word.length;
        const autoHint1 = {
          type: "hint",
          from: room.hostName || "출제자",
          text: `정답 단어는 ${len}글자입니다.`
        };
        room.chat.push(autoHint1);
        io.to(roomCode).emit("newHint", autoHint1);
      }

      // 15번째 질문: 첫 글자 초성 힌트
      if (room.questionCount === 15) {
        const firstChar = room.word[0] || "";
        const firstChosung = computeChosung(firstChar);
        const autoHint2 = {
          type: "hint",
          from: room.hostName || "출제자",
          text: `첫 글자 초성은 ${firstChosung} 입니다.`
        };
        room.chat.push(autoHint2);
        io.to(roomCode).emit("newHint", autoHint2);
      }
    }

    emitRoomChatState(roomCode);
  });

  // ====== 일반 채팅 메시지 ======
  socket.on("sendChatMessage", ({ roomCode, text, nickname }) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (!text || !text.trim()) return;

  const trimmed = text.trim();

  // 닉네임 설정 (기존 코드 유지)
  let senderName = nickname && nickname.trim();
  if (!senderName) {
    if (socket.id === room.hostId) {
      senderName = room.hostName || "출제자";
    } else {
      const g = room.guessers.find((gg) => gg.id === socket.id);
      senderName = g ? g.name : "참가자";
    }
  }

  // ===== 🎭 특수 이펙트 명령어 처리 =====
  switch (trimmed) {
    case "/똥":
      io.to(roomCode).emit("effect", { type: "poopRain" }); // 💩
      return;
    case "/붐따":
      io.to(roomCode).emit("effect", { type: "boomDown" }); // 👎
      return;
    case "/붐업":
      io.to(roomCode).emit("effect", { type: "boomUp" }); // 👍
      return;
    case "/게이":
      io.to(roomCode).emit("effect", { type: "gayFlag" }); // 🏳️‍🌈
      return;
    case "/미침":
      io.to(roomCode).emit("effect", { type: "skull" }); // ☠️
      return;
  }

  // ===== 일반 채팅 메시지 =====
  const chatMsg = {
    type: "chat",
    from: senderName,
    text: trimmed,
    ts: Date.now()
  };

  room.chat.push(chatMsg);
  io.to(roomCode).emit("newChatMessage", chatMsg);
  emitRoomChatState(roomCode);
});

  // ====== 출제자가 참가자 강퇴 ======
  socket.on("kickPlayer", ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (!room) return;

    // 권한 체크: 요청한 소켓이 방의 host여야만 함
    if (socket.id !== room.hostId) {
      return;
    }

    // 호스트 자신은 강퇴 불가
    if (playerId === room.hostId) return;

    const idx = room.guessers.findIndex((g) => g.id === playerId);
    if (idx === -1) {
      return;
    }

    const [removed] = room.guessers.splice(idx, 1);

    const kickedSocket = io.sockets.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(roomCode);
      kickedSocket.emit("kicked", { reason: "host_kick" });
    }

    room.chat.push({
      type: "system",
      from: "[SYSTEM]",
      text: `${removed.name || "참가자"} 님이 강퇴되었습니다.`
    });

    emitPlayers(roomCode);
    emitRoomChatState(roomCode);
  });

  // ====== 연결 해제 처리 ======
  socket.on("disconnect", () => {
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (!room) continue;

      if (room.hostId === socket.id) {
        // 방장(출제자) 나감 → 방 종료
        io.to(roomCode).emit("roomClosed");
        cleanupRoom(roomCode);
        continue;
      }

      const idx = room.guessers.findIndex((g) => g.id === socket.id);
      if (idx !== -1) {
        const [leaver] = room.guessers.splice(idx, 1);

        // (선택) 시스템 메시지로 남길 수도 있음
        // room.chat.push({
        //   type: "system",
        //   from: "[SYSTEM]",
        //   text: `${leaver.name || "참가자"} 님이 퇴장했습니다.`
        // });

        emitPlayers(roomCode);
        emitRoomChatState(roomCode);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
