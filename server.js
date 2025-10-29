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

app.use(cors({
  origin: function (origin, callback) {
    // Render의 헬스체크나 같은-origin 호출은 origin이 빈값일 수도 있다.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS blocked: " + origin));
    }
  }
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  }
});

/*
rooms[roomCode] = {
  word: null,
  wordLocked: false,
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

// ====== 게임 종료 유틸 ======
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
  socket.on("createRoom", ({ roomCode, nickname }) => {
    if (!roomCode) {
      socket.emit("errorMsg", "방 코드를 입력하세요.");
      return;
    }
    if (rooms[roomCode]) {
      socket.emit("errorMsg", "이미 존재하는 방 코드입니다.");
      return;
    }

    rooms[roomCode] = {
      word: null,
      wordLocked: false,
      hostId: socket.id,
      hostName: nickname || "출제자",
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

    socket.emit("roomJoined", {
      role: "host",
      roomCode,
      word: null,
      wordLocked: false,
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
      word: socket.id === room.hostId ? room.word : undefined,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 현재 채팅/상태를 쏴줌
    emitRoomChatState(roomCode);

    // 참가자 목록 브로드캐스트
    emitPlayers(roomCode);
  });

  // 출제자: 단어 설정
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

  // 출제자: 힌트
  socket.on("sendHint", ({ roomCode, text }) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (socket.id !== room.hostId) return;
  if (!text || !text.trim()) return;
  if (room.gameOver) return;

  const trimmed = text.trim();

  // 🔥 추가: 특수 이펙트 커맨드
  if (trimmed === "/똥") {
    // 모든 인원에게 이펙트 트리거만 쏨. 채팅에는 안 남김.
    io.to(roomCode).emit("effect", { type: "poopRain" });
    return;
  }

  // 기본 힌트 처리 (원래 코드)
  const hintMsg = {
    type: "hint",
    from: room.hostName || "출제자",
    text: trimmed
  };
  room.chat.push(hintMsg);

  io.to(roomCode).emit("newHint", hintMsg);
  emitRoomChatState(roomCode);
});

  // 참가자: 질문
  socket.on("askQuestion", ({ roomCode, text, nickname }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.gameOver) return;
    if (!text || !text.trim()) return;

    // 출제자는 질문 금지
    if (socket.id === room.hostId) return;

    // 단어 설정 안 됐으면 금지
    if (!room.wordLocked || !room.word) return;

    // 이전 질문 답변 대기 중이면 금지
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

  // 출제자: 답변
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

    if (kind === "correct") {
      // 참가자 승리 (출제자 패배)
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

      // 방 종료
      cleanupRoom(roomCode);
      return;
    }

    // 정답이 아니면 다음 질문 가능
    room.waitingForAnswer = null;

    // 질문 20개 쓰면 참가자 패배
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

      cleanupRoom(roomCode);
      return;
    }

    // 아직 안 끝났으면 답만 뿌림
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

    emitRoomChatState(roomCode);
  });

  // ====== [NEW CHAT] 참가자/출제자 일반 채팅 메시지 ======
  // payload: { roomCode, text, nickname }
  // 이건 질문/힌트랑 별개로 그냥 자유 채팅
  socket.on("sendChatMessage", ({ roomCode, text, nickname }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (!text || !text.trim()) return;

    // 닉 결정: 넘어온 nickname이 우선, 없으면 guessers/host에서 찾는다
    let senderName = nickname && nickname.trim();
    if (!senderName) {
      if (socket.id === room.hostId) {
        senderName = room.hostName || "출제자";
      } else {
        const g = room.guessers.find((gg) => gg.id === socket.id);
        senderName = g ? g.name : "참가자";
      }
    }

    const chatMsg = {
      type: "chat",
      from: senderName,
      text: text.trim(),
      ts: Date.now()
    };

    // 로그에 추가
    room.chat.push(chatMsg);

    // 방 전체에 새 메시지 밀어주기
    io.to(roomCode).emit("newChatMessage", chatMsg);

    // 전체 상태도 동기화해주면 프론트가 새로 들어온 애도 consistent
    emitRoomChatState(roomCode);
  });

  // ====== 출제자가 참가자 강퇴 ======
  // payload: { roomCode, playerId }
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

    // 참가자 목록에서 제거
    const [removed] = room.guessers.splice(idx, 1);

    // 강퇴 대상 소켓 찾아서 알림
    const kickedSocket = io.sockets.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(roomCode);
      kickedSocket.emit("kicked", { reason: "host_kick" });
      // kickedSocket.disconnect(true); // 강제 연결 종료하고 싶으면 주석 해제
    }

    // 시스템 메시지로 기록
    room.chat.push({
      type: "system",
      from: "[SYSTEM]",
      text: `${removed.name || "참가자"} 님이 강퇴되었습니다.`
    });

    // 최신 상태 방송
    emitPlayers(roomCode);
    emitRoomChatState(roomCode);
  });

  // ====== 연결 해제 처리 ======
  socket.on("disconnect", () => {
    // 1) 방장(출제자)였던 방 정리
    for (const [roomCode, room] of Object.entries(rooms)) {
      if (!room) continue;

      if (room.hostId === socket.id) {
        // 방장 나감 -> 방 폭파
        io.to(roomCode).emit("roomClosed");
        cleanupRoom(roomCode);
        continue;
      }

      // 2) 참가자였던 방 정리
      const idx = room.guessers.findIndex((g) => g.id === socket.id);
      if (idx !== -1) {
        const [leaver] = room.guessers.splice(idx, 1);

        // 나간 사실은 시스템 메시지로 남겨도 상관없음 (선택)
        // room.chat.push({
        //   type: "system",
        //   from: "[SYSTEM]",
        //   text: `${leaver.name || "참가자"} 님이 퇴장했습니다.`
        // });

        // 남아있는 사람들에게 최신 상태 전송
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
