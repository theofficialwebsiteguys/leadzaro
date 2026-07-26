import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ProjectChannel, Message } from '../models/message.model';
import { Task } from '../models/task.model';

@Injectable({ providedIn: 'root' })
export class MessagingService {
  private http = inject(HttpClient);

  listChannels(projectId: string): Observable<{ data: { channels: ProjectChannel[] } }> {
    return this.http.get<{ data: { channels: ProjectChannel[] } }>(`/api/v1/projects/${projectId}/channels`);
  }

  listMessages(projectId: string, channelId: string): Observable<{ data: { messages: Message[] } }> {
    return this.http.get<{ data: { messages: Message[] } }>(`/api/v1/projects/${projectId}/channels/${channelId}/messages`);
  }

  postMessage(projectId: string, channelId: string, body: string): Observable<{ data: { message: Message } }> {
    return this.http.post<{ data: { message: Message } }>(`/api/v1/projects/${projectId}/channels/${channelId}/messages`, { body });
  }

  convertToTask(projectId: string, channelId: string, messageId: string, isClientVisible = false): Observable<{ data: { task: Task } }> {
    return this.http.post<{ data: { task: Task } }>(`/api/v1/projects/${projectId}/channels/${channelId}/messages/${messageId}/convert-to-task`, { isClientVisible });
  }
}
