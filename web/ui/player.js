document.addEventListener('DOMContentLoaded', function () {
    const video = document.getElementById('radioPlayer');
    // For V1, we hardcode the stream URL for cd_track_12
    const streamUrl = '/stream/cd_track_12/playlist.m3u8'; 

    if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            console.log('Manifest parsed, attempting to play...');
            video.play().catch(error => console.error('Autoplay failed:', error));
        });
        hls.on(Hls.Events.ERROR, function (event, data) {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.error('Fatal network error encountered, trying to recover:', data);
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.error('Fatal media error encountered, trying to recover:', data);
                        hls.recoverMediaError();
                        break;
                    default:
                        console.error('Fatal HLS error, cannot recover:', data);
                        hls.destroy();
                        break;
                }
            } else {
                console.warn('Non-fatal HLS error:', data);
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // For Safari and other browsers that support HLS natively
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', function () {
            video.play().catch(error => console.error('Autoplay failed:', error));
        });
    } else {
        console.error('HLS is not supported in this browser.');
        alert('Sorry, your browser does not support HLS playback.');
    }
}); 