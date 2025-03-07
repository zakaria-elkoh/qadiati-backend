import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FriendRequestType } from './friendRequest.schema';
import { NotificationTypeEnum } from '../notifications/notificationTypes';
import FriendsService from './friends.service';
import NotificationService from '../notifications/notifications.service';
import UsersService from '../users/users.service';
import { FriendshipType } from './friendship.schema';

@Injectable()
@Controller('api/friends')
export default class FriendsController {
  constructor(
    @InjectModel('FriendRequest')
    readonly friendRequestModel: Model<FriendRequestType>,
    @InjectModel('Friendship') readonly friendshipModel: Model<FriendshipType>,
    readonly usersService: UsersService,
    readonly friendsService: FriendsService,
    readonly notificationsService: NotificationService,
  ) {}

  @Get('/:userId')
  async getUserFriends(@Param('userId') userId: string) {
    const friends = await this.friendsService.getUserFriends(userId);
    return friends;
  }

  @Delete('/delete/:userId')
  async deleteFriendship(@Req() req: any, @Param('userId') userId: string) {
    const loggedInUserId = req.user.id;
    if (userId === process.env.ADMIN_ID) {
      throw new HttpException(
        'This action cannot be performed for the admin',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.friendshipModel.deleteOne({
      users: { $all: [userId, loggedInUserId] },
    });
    return 'Friend deleted successfully';
  }

  @Get('/requests/me/sent')
  async getUserSentFriendRequest(@Req() req: any) {
    const userId = req.user.id;
    return await this.friendRequestModel.find({ from: userId });
  }
  @Get('/requests/me/received')
  async getUserReceivedFriendRequest(@Req() req: any) {
    const userId = req.user.id;
    return await this.friendRequestModel.find({ to: userId });
  }

  @Post('/requests/send')
  async sendFriendRequest(@Body() body: { to: string }, @Req() req: any) {
    const fromUserId = req.user.id;
    const toUserId = body.to;
    const sender = await this.usersService.findById(fromUserId);
    const receiver = await this.usersService.findById(toUserId);

    if (fromUserId === toUserId)
      throw new HttpException('The 2 ids are the same', HttpStatus.BAD_REQUEST);

    if (!receiver || !sender)
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    const requestAlreadyExists = await this.friendRequestModel.findOne({
      $or: [
        {
          from: fromUserId,
          to: toUserId,
        },
        {
          to: fromUserId,
          from: toUserId,
        },
      ],
    });

    if (requestAlreadyExists)
      throw new HttpException('Request already sent', HttpStatus.BAD_REQUEST);

    const isAlreadyFriend = await this.friendshipModel.findOne({
      users: { $all: [fromUserId, toUserId] },
    });

    if (isAlreadyFriend)
      throw new HttpException(
        'This user is already in your friend list',
        HttpStatus.BAD_REQUEST,
      );

    const friendRequest = await this.friendRequestModel.create({
      from: fromUserId,
      to: toUserId,
    });

    this.notificationsService.sendFriendRequestNotification(
      friendRequest.from,
      friendRequest.to,
      friendRequest.id,
      NotificationTypeEnum.friendRequest,
    );

    return friendRequest;
  }

  @Delete('/requests/:friendRequestId')
  async deleteFriendRequest(
    @Param('friendRequestId') friendRequestId: string,
    @Req() req: any,
  ) {
    const userId = req.user.id;
    const friendRequest = await this.friendRequestModel.findById(
      friendRequestId,
    );
    if (!friendRequest)
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);

    if (!this.friendsService.isPartOfFriendRequest(userId, friendRequest))
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

    await friendRequest.deleteOne();
    return 'Request deleted successfully';
  }

  @Delete('/requests/:friendRequestId/accept')
  async acceptFriendRequest(
    @Param('friendRequestId') friendRequestId: string,
    @Req() req: any,
  ) {
    const userId = req.user.id;

    const friendRequest = await this.friendRequestModel.findById(
      friendRequestId,
    );
    if (!friendRequest)
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);

    if (!this.friendsService.isFriedRequestRecepient(userId, friendRequest))
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

    const friendship = await this.friendshipModel.create({
      users: [friendRequest.from, friendRequest.to],
    });

    this.notificationsService.sendFriendRequestNotification(
      friendRequest.to,
      friendRequest.from,
      friendRequest.id,
      NotificationTypeEnum.friendRequestAccepted,
    );

    friendRequest.deleteOne();

    return friendship;
  }
}
