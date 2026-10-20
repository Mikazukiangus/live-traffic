import React from 'react';
import { getResolvedCameraUrl } from './images';
export function CameraImage({
  imageUrl,
  ...props
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { imageUrl: string }) {
  return (
    <img
      key={imageUrl}
      {...props}
      src={getResolvedCameraUrl(imageUrl)}
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      onError={(event) => {
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}
