(function () {
            // ========== STATE MANAGEMENT ==========
            let peer, currentCall;
            let localStream = null;
            let controlsTimeout;
            const controls = document.getElementById('controls');
            const urlParams = new URLSearchParams(location.search);
            let myPeerId = urlParams.get('mypeerid');
            const targetPeerId = urlParams.get('targetpeerid');

            // ========== EVENT BRIDGE ==========
            const EventBridge = {
                send: (type, data) => {
                    const eventData = {
                        type,
                        peerId: myPeerId,
                        ...data
                    };
                    console.log(`CALL_EVENT:${JSON.stringify(eventData)}`);
                }
            };

            // ========== INITIALIZATION ==========
            if (!myPeerId) {
                myPeerId = generatePeerId();
                window.location.replace(`?mypeerid=${myPeerId}`);
                return;
            }

            // ========== AUTO-HIDE CONTROLS ==========
            function resetControlsTimer() {
                controls.classList.remove('controls-hidden');
                clearTimeout(controlsTimeout);
                controlsTimeout = setTimeout(() => {
                    controls.classList.add('controls-hidden');
                }, 3000);
            }

            document.body.addEventListener('click', resetControlsTimer);
            document.body.addEventListener('touchstart', resetControlsTimer);

            async function initialize() {
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: true
                    });
                    document.getElementById('localVideo').srcObject = localStream;
                    setupPeerConnection();
                    setupControls();
                    resetControlsTimer();
                } catch (err) {
                    handleError(err);
                }
            }

            // ========== PEER CONNECTION ==========
            function setupPeerConnection() {
                peer = new Peer(myPeerId, {
                    host: '0.peerjs.com',
                    port: 443,
                    secure: true,
                    debug: 3
                });

                peer.on('open', () => {
                    EventBridge.send('PEER_READY');
                    // Auto-initiate call if target exists
                    if (targetPeerId) initiateCall();
                });

                peer.on('call', handleIncomingCall);
                peer.on('error', handleError);
                peer.on('close', handlePeerClose);
            }

            // ========== CALL HANDLING ==========
            function initiateCall() {
                EventBridge.send('CALL_STATUS', {status: 'initiating'});
                currentCall = peer.call(targetPeerId, localStream);

                currentCall.on('stream', remoteStream => {
                    document.getElementById('remoteVideo').srcObject = remoteStream;
                    EventBridge.send('CALL_STATUS', {status: 'connected'});
                });

                currentCall.on('close', () => {
                    EventBridge.send('CALL_STATUS', {status: 'ended'});
                    cleanup();
                });

                currentCall.on('error', err => {
                    EventBridge.send('CALL_STATUS', {status: 'error', error: err.message});
                    cleanup();
                });
            }

            function handleIncomingCall(call) {
                EventBridge.send('CALL_STATUS', {status: 'receiving'});
                call.answer(localStream);
                currentCall = call;

                call.on('stream', remoteStream => {
                    document.getElementById('remoteVideo').srcObject = remoteStream;
                    EventBridge.send('CALL_STATUS', {status: 'connected'});
                });

                call.on('close', () => {
                    EventBridge.send('CALL_STATUS', {status: 'ended'});
                    cleanup();
                });

                call.on('error', err => {
                    EventBridge.send('CALL_STATUS', {status: 'error', error: err.message});
                    cleanup();
                });
            }

            // ========== CONTROL HANDLERS ==========
            function setupControls() {
                // Camera Switch
                document.getElementById('switchCamera').addEventListener('click', async () => {
                    try {
                        const currentTrack = localStream.getVideoTracks()[0];
                        const newFacingMode = currentTrack.getSettings().facingMode === 'user' ? 'environment' : 'user';
                        const newStream = await navigator.mediaDevices.getUserMedia({
                            video: {facingMode: newFacingMode}
                        });

                        // Remove old track and add new track
                        localStream.removeTrack(currentTrack);
                        localStream.addTrack(newStream.getVideoTracks()[0]);
                        currentTrack.stop();

                        // Update the local video element's transform style to reflect the mirrored state
                        const localVideoElement = document.getElementById('localVideo');
                        if (newFacingMode === 'user') {
                            // Apply mirroring for the 'user' facing mode (front camera)
                            localVideoElement.style.transform = 'scaleX(-1)';
                        } else {
                            // Remove mirroring for the 'environment' facing mode (back camera)
                            localVideoElement.style.transform = 'scaleX(1)';
                        }

                        // Replace the video track in the ongoing call (if any)
                        if (currentCall) {
                            const sender = currentCall.peerConnection.getSenders()
                                .find(s => s.track.kind === 'video');
                            sender.replaceTrack(newStream.getVideoTracks()[0]);
                        }
                    } catch (err) {
                        handleError(err);
                    }
                });

                // Mute/Unmute
                document.getElementById('muteBtn').addEventListener('click', () => {
                    const audioTrack = localStream.getAudioTracks()[0];
                    if (audioTrack) {
                        audioTrack.enabled = !audioTrack.enabled;
                        document.getElementById('muteBtn').classList.toggle('active', !audioTrack.enabled);
                        document.getElementById('muteBtn').querySelector('i').textContent =
                            audioTrack.enabled ? 'mic' : 'mic_off';
                    }
                });

                // End Call
                document.getElementById('endCall').addEventListener('click', () => {
                    EventBridge.send('CALL_STATUS', {status: 'ended'});
                    cleanup();
                });
            }

            // ========== UTILITIES ==========
            function generatePeerId() {
                return 'peer-' + Math.random().toString(36).substr(2, 9);
            }

            function handlePeerClose() {
                EventBridge.send('PEER_STATUS', {status: 'closed'});
                cleanup();
            }

            function handleError(err) {
                EventBridge.send('ERROR', {
                    message: err instanceof Error ? err.message : String(err),
                    stack: err.stack || 'No stack trace'
                });
            }

            function cleanup() {
                try {
                    if (currentCall) currentCall.close();
                    if (peer) peer.destroy();
                    if (localStream) localStream.getTracks().forEach(track => track.stop());
                    const remoteVideo = document.getElementById('remoteVideo');
                    if (remoteVideo.srcObject) remoteVideo.srcObject.getTracks().forEach(track => track.stop());
                } catch (err) {
                    EventBridge.send('ERROR', {message: 'Cleanup failed', error: err.message});
                }
            }

            // Start the application
            initialize();
        })();
