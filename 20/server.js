// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

/*
rooms[roomCode] = {
  word: "아이폰",
  wordLocked: true,              // 단어 설정 완료 여부
  hostId: "socket1",             // 출제자
  hostName: "출제자닉",

  guessers: [ {id:"socket2", name:"정답자1"}, {id:"socket3", name:"정답자2"} ],

  chat: [
    { type:"q",    id:1, from:"정답자1", text:"전자기기인가요?" },
    { type:"a",    qid:1, from:"출제자닉", kind:"yes" },
    { type:"hint", from:"출제자닉", text:"거의 항상 들고 다님" }
  ],

  lastQuestionId: 1,
  questionCount: 1,              // 질문(누가 했든 host 아닌 쪽 질문 수)
  waitingForAnswer: 1,           // 아직 답 안 된 질문 id (없으면 null)

  gameOver: false,
  gameResultForHost: null,       // "hostWin" | "hostLose"
  gameResultForGuesser: null,    // "guesserWin" | "guesserLose"
  finalWordShown: false          // 게임 종료 후 정답 공개 여부
};
*/

const rooms = {};

function broadcastRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // 방에 있는 모든 소켓에게 현재 상태를 보낸다.
  // 각 클라이언트는 자기 역할을 프론트에서 유추( hostId === 나 )로만 안 하고,
  // 서버가 role도 같이 내려주도록 하자.
  [...io.sockets.sockets.values()].forEach((sock) => {
    if (!sock.rooms.has(roomCode)) return;
    const isHost = sock.id === room.hostId;
    io.to(sock.id).emit("roomState", {
      role: isHost ? "host" : "guesser",
      roomCode,
      word: isHost ? room.word : undefined,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });
  });
}

// 출제자 승리(참가자 패배)
function endGameGuesserLose(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostWin";
  room.gameResultForGuesser = "guesserLose";
  room.finalWordShown = true;
}

// 참가자 승리(출제자 패배)
function endGameGuesserWin(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostLose";
  room.gameResultForGuesser = "guesserWin";
  room.finalWordShown = true;
}

// 게임 끝난 후 방 삭제 (즉시 재사용 가능)
function cleanupRoom(roomCode) {
  delete rooms[roomCode];
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
  });

  // 참가자(정답자): 방 참여 (여러 명 허용)
  socket.on("joinRoom", ({ roomCode, nickname }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("errorMsg", "존재하지 않는 방 코드입니다.");
      return;
    }

    socket.join(roomCode);

    // guessers 배열에 없으면 추가
    if (!room.guessers.find((g) => g.id === socket.id)) {
      room.guessers.push({
        id: socket.id,
        name: nickname || "정답자"
      });
    }

    // 방에 들어온 그 사람에게 현재 상태 주기
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

    // 전체에게 히스토리/상태 브로드캐스트
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
  });

  // 출제자: 정답 단어 설정 (한 번만 가능)
  socket.on("setWord", ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.wordLocked) return;
    if (!word || !word.trim()) return;

    room.word = word.trim();
    room.wordLocked = true;

    // 방 전체에 상태 브로드캐스트 (이걸로 정답자 쪽 "단어 아직 없음" 메시지 해제)
    broadcastRoomState(roomCode);
  });

  // 출제자: 힌트 보내기
  socket.on("sendHint", ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (!text || !text.trim()) return;
    if (room.gameOver) return; // 끝난 게임이면 의미 없음

    const hintMsg = {
      type: "hint",
      from: room.hostName || "출제자",
      text: text.trim()
    };
    room.chat.push(hintMsg);

    io.to(roomCode).emit("newHint", hintMsg);
  });

  // 참가자: 질문
  socket.on("askQuestion", ({ roomCode, text, nickname }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.gameOver) return;
    if (!text || !text.trim()) return;

    // 출제자는 질문 불가
    if (socket.id === room.hostId) return;

    // 단어 아직 안 정해졌으면 질문 금지
    if (!room.wordLocked || !room.word) return;

    // 아직 답 안 나온 질문이 대기 중이면 새 질문 금지
    if (room.waitingForAnswer) return;

    // 질문 기회 초과 시 즉시 패배
    if (room.questionCount >= 20) {
      endGameGuesserLose(room);

      io.to(roomCode).emit("gameOver", {
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      io.to(roomCode).emit("roomState", {
        role: socket.id === room.hostId ? "host" : "guesser",
        roomCode,
        wordLocked: room.wordLocked,
        questionCount: room.questionCount,
        waitingForAnswer: room.waitingForAnswer,
        gameOver: room.gameOver,
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      // 방 삭제
      cleanupRoom(roomCode);
      return;
    }

    // 질문 등록
    room.lastQuestionId += 1;
    room.questionCount += 1;

    // 질문 보낸 사람 닉네임
    let askerName = nickname;
    if (!askerName) {
      const g = room.guessers.find((gg) => gg.id === socket.id);
      askerName = g ? g.name : "정답자";
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
  });

  // 출제자: 답변
socket.on("answerQuestion", ({ roomCode, questionId, kind }) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (socket.id !== room.hostId) return;
  if (room.gameOver) return;
  if (room.waitingForAnswer !== questionId) return;

  // 답변 메시지 생성
  const a = {
    type: "a",
    qid: questionId,
    from: room.hostName || "출제자",
    kind // "yes" | "no" | "idk" | "correct"
  };
  room.chat.push(a);

  // 출제자가 "정답 🎉" 눌렀을 경우 -> 참가자 승리
  if (kind === "correct") {
    // 참가자 승리 / 출제자 패배
    endGameGuesserWin(room);

    // 모두에게 마지막 답변 브로드캐스트
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

    // 게임 종료 알림 (정답 공개 포함)
    io.to(roomCode).emit("gameOver", {
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 방 코드 재사용 가능하도록 방 삭제
    cleanupRoom(roomCode);
    return;
  }

  // 정답이 아닌 경우:
  // 이제 이 질문은 답변 완료됐으니까 다음 질문 가능하게 풀어준다
  room.waitingForAnswer = null;

  // BUT: 여기서 "20번째 질문까지 썼는데 아직 못 맞춤"이면
  //     = questionCount 가 20 이상이면 즉시 참가자 패배 처리
  //     (즉, 더 이상 다음 질문 기대하지 않고 그냥 게임 끝)
  if (room.questionCount >= 20) {
    // 참가자 패배 / 출제자 승리
    endGameGuesserLose(room);

    // 마지막 답변 브로드캐스트 (이미 오답 답변도 보여줘야 하니까)
    io.to(roomCode).emit("newAnswer", {
      ...a,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer, // 지금 null이지만 어차피 끝남
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 게임 종료 알림 + 정답 공개
    io.to(roomCode).emit("gameOver", {
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 방 삭제해서 이 코드 재사용 가능하게
    cleanupRoom(roomCode);
    return;
  }

  // 아직 20개 다 안 쓴 상태라면 그냥 정상 진행 (게임은 안 끝남)
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
});// 출제자: 답변
socket.on("answerQuestion", ({ roomCode, questionId, kind }) => {
  const room = rooms[roomCode];
  if (!room) return;
  if (socket.id !== room.hostId) return;
  if (room.gameOver) return;
  if (room.waitingForAnswer !== questionId) return;

  // 답변 메시지 생성
  const a = {
    type: "a",
    qid: questionId,
    from: room.hostName || "출제자",
    kind // "yes" | "no" | "idk" | "correct"
  };
  room.chat.push(a);

  // 출제자가 "정답 🎉" 눌렀을 경우 -> 참가자 승리
  if (kind === "correct") {
    // 참가자 승리 / 출제자 패배
    endGameGuesserWin(room);

    // 모두에게 마지막 답변 브로드캐스트
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

    // 게임 종료 알림 (정답 공개 포함)
    io.to(roomCode).emit("gameOver", {
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 방 코드 재사용 가능하도록 방 삭제
    cleanupRoom(roomCode);
    return;
  }

  // 정답이 아닌 경우:
  // 이제 이 질문은 답변 완료됐으니까 다음 질문 가능하게 풀어준다
  room.waitingForAnswer = null;

  // BUT: 여기서 "20번째 질문까지 썼는데 아직 못 맞춤"이면
  //     = questionCount 가 20 이상이면 즉시 참가자 패배 처리
  //     (즉, 더 이상 다음 질문 기대하지 않고 그냥 게임 끝)
  if (room.questionCount >= 20) {
    // 참가자 패배 / 출제자 승리
    endGameGuesserLose(room);

    // 마지막 답변 브로드캐스트 (이미 오답 답변도 보여줘야 하니까)
    io.to(roomCode).emit("newAnswer", {
      ...a,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer, // 지금 null이지만 어차피 끝남
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 게임 종료 알림 + 정답 공개
    io.to(roomCode).emit("gameOver", {
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 방 삭제해서 이 코드 재사용 가능하게
    cleanupRoom(roomCode);
    return;
  }

  // 아직 20개 다 안 쓴 상태라면 그냥 정상 진행 (게임은 안 끝남)
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
});


  socket.on("disconnect", () => {
    // 단순히 끊겼다고 해서 방을 정리하지는 않는다.
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log("listening on http://localhost:" + PORT);
});
