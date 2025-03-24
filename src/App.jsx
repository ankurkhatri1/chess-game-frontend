import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import Peer from 'peerjs';
import './App.css';

const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 1000,
});

function App() {
  const [game, setGame] = useState(new Chess());
  const [position, setPosition] = useState('start');
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const [role, setRole] = useState(null);
  const [color, setColor] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentTurn, setCurrentTurn] = useState('white');
  const [error, setError] = useState('');
  const [socketConnected, setSocketConnected] = useState(false);

  // Socket Connection Handling
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setSocketConnected(true);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err);
      setError('Socket connection failed: ' + err.message);
      setSocketConnected(false);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setSocketConnected(false);
      setIsConnected(false);
    });

    socket.on('move', ({ san, fen }) => {
      const newGame = new Chess(fen);
      setGame(newGame);
      setPosition(fen);
    });

    socket.on('role', ({ role, color, peerId }) => {
      console.log(`Assigned role: ${role}, color: ${color}, peerId: ${peerId}`);
      setRole(role);
      setColor(color);
    });

    socket.on('start', ({ turn, fen }) => {
      console.log('Game started, turn:', turn);
      setIsConnected(true);
      setCurrentTurn(turn);
      setPosition(fen);
      setGame(new Chess(fen));
    });

    socket.on('turn', (turn) => {
      console.log('Current turn:', turn);
      setCurrentTurn(turn);
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
      setError(err);
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.off('move');
      socket.off('role');
      socket.off('start');
      socket.off('turn');
      socket.off('error');
    };
  }, []);

  // WebRTC Logic with PeerJS
  useEffect(() => {
    if (!role || !isConnected || !socketConnected) return;

    let localStream;
    let peerInstance;

    const initPeer = async () => {
      try {
        console.log('Initializing PeerJS...');
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });

        if (localAudioRef.current) {
          localAudioRef.current.srcObject = localStream;
          localAudioRef.current.muted = true;
          await localAudioRef.current.play();
          console.log('Local audio stream set');
        } else {
          setError('Local audio element not found!');
          console.error('Local audio ref is null');
          return;
        }

        peerInstance = new Peer({
          initiator: role === 'initiator',
          trickle: true,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
              {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject',
              },
              {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject',
              },
            ],
          },
        });

        peerRef.current = peerInstance;

        peerInstance.on('open', (id) => {
          console.log('PeerJS ID:', id);
          socket.emit('peer-id', { peerId: id, role });
        });

        peerInstance.on('call', (call) => {
          console.log('Receiving call...');
          call.answer(localStream);
          call.on('stream', (remoteStream) => {
            console.log('Received remote audio stream');
            if (remoteAudioRef.current) {
              remoteAudioRef.current.srcObject = remoteStream;
              remoteAudioRef.current.play().catch((e) => console.error('Remote audio play error:', e));
            }
          });
        });

        socket.on('peer-id', ({ peerId, role: remoteRole }) => {
          if (role === 'initiator' && remoteRole === 'receiver') {
            console.log('Calling receiver with Peer ID:', peerId);
            const call = peerInstance.call(peerId, localStream);
            call.on('stream', (remoteStream) => {
              console.log('Received remote audio stream from receiver');
              if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = remoteStream;
                remoteAudioRef.current.play().catch((e) => console.error('Remote audio play error:', e));
              }
            });
            call.on('error', (err) => {
              console.error('Call error:', err);
              setError('Call error: ' + err.message);
            });
          }
        });

        peerInstance.on('error', (err) => {
          console.error('Peer error:', err);
          setError('Peer connection error: ' + err.message);
        });

        peerInstance.on('close', () => {
          console.log('Peer connection closed');
        });
      } catch (err) {
        console.error('Media error:', err);
        setError('Mic access denied or error: ' + err.message);
      }
    };

    initPeer();

    return () => {
      console.log('Cleaning up PeerJS...');
      if (peerInstance) {
        peerInstance.destroy();
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      socket.off('peer-id');
    };
  }, [role, isConnected, socketConnected]);

  // Handle Chess Moves
  const onDrop = (sourceSquare, targetSquare) => {
    if (color !== currentTurn) {
      alert('TERI BAARI NAHI HAI, BHAI! DUSHMAN KA WAIT KAR!');
      return false;
    }

    const newGame = new Chess(game.fen());
    const move = newGame.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q',
    });

    if (move === null) {
      alert('GALAT CHAL, BHAI! SOCH KE KHEL!');
      return false;
    }

    setGame(newGame);
    setPosition(newGame.fen());
    socket.emit('move', move.san);
    return true;
  };

  return (
    <div className="App">
      <h1>CHESS WITH VOICE CALL, LADAI SHURU!</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!socketConnected && <p style={{ color: 'red' }}>Connecting to server...</p>}
      <div className="game-container">
        <Chessboard
          position={position}
          onPieceDrop={onDrop}
          boardWidth={500}
          customBoardStyle={{
            borderRadius: '4px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
          }}
        />
        <div className="audio-container">
          <div className="audio-box">
            <audio ref={localAudioRef} autoPlay playsInline />
            <div className="audio-label">TU ({color || 'Wait'})</div>
          </div>
          <div className="audio-box">
            <audio ref={remoteAudioRef} autoPlay playsInline />
            <div className="audio-label">DUSHMAN</div>
          </div>
        </div>
      </div>
      <div className="status">
        {role && `TU ${role.toUpperCase()} HAI, COLOR: ${color?.toUpperCase()}`} <br />
        {isConnected ? `CONNECTED! AB ${currentTurn.toUpperCase()} KI BAARI!` : 'DUSHMAN KA WAIT KAR...'}
      </div>
    </div>
  );
}

export default App;