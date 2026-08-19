import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_BASE_URL } from '../../core/api-config';

export interface ImageLibraryItem {
  id: string;
  name: string;
  format: string;
  size: number | null;
  width: number;
  height: number;
  status: string;
  createdAt: string;
  src: string;
}

const MIME_TO_FORMAT: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
};

export const SUPPORTED_FORMATS = Object.keys(MIME_TO_FORMAT);
export const SUPPORTED_EXTENSIONS = '.jpg,.jpeg,.png,.webp';

export function mimeToFormat(mime: string): string | null {
  return MIME_TO_FORMAT[mime] ?? null;
}

@Injectable({ providedIn: 'root' })
export class AnalyzeService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);

  getImages(): Observable<ImageLibraryItem[]> {
    return this.http
      .get<{ success: boolean; images: ImageLibraryItem[] }>(`${this.apiBase}/api/images`)
      .pipe(map(res => res.images));
  }

  uploadImage(payload: {
    name: string;
    src: string;
    format: string;
    width: number;
    height: number;
    size: number;
  }): Observable<ImageLibraryItem> {
    // Backend's ImageModel requires id and createdAt even on POST (ignored server-side)
    const body = {
      id: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date().toISOString(),
      ...payload,
    };
    return this.http
      .post<{ success: boolean; savedImage: ImageLibraryItem }>(`${this.apiBase}/api/images`, body)
      .pipe(map(res => ({ ...res.savedImage, src: `/api/images/${res.savedImage.id}/file` })));
  }

  imageFileUrl(relativeSrc: string): string {
    return `${this.apiBase}${relativeSrc}`;
  }
}
